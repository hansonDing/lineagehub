/**
 * 演示模式种子数据(与 backend/app/seed.py 完全一致的电商数仓演示)。
 * 仅存放原始常量;表/字段/血缘边由 mock/engine 对这些 SQL 真实解析生成,
 * 与后端「全部用解析引擎真实解析生成,不手写边」的口径保持一致。
 */

import type { SystemKind } from '@/lib/api'

// ---------------------------------------------------------------- 系统
export const SEED_SYSTEMS: {
  name: string
  kind: SystemKind
  owner: string
  contact: string
  description: string
}[] = [
  { name: 'Order Center', kind: 'source', owner: 'Hanson', contact: 'hanson@example.com', description: 'Transactional order business database' },
  { name: 'User Center', kind: 'source', owner: 'Jacky', contact: 'jacky@example.com', description: 'User master data database' },
  { name: 'BI Platform', kind: 'target', owner: 'Jerry', contact: 'jerry@example.com', description: 'Business analysis dashboard platform' },
  { name: 'Finance System', kind: 'target', owner: 'Maggie', contact: 'maggie@example.com', description: 'Financial accounting and reporting system' },
]

// ---------------------------------------------------------------- DDL
export const DDL_TRADE_ORDER = `CREATE TABLE IF NOT EXISTS ods.ods_trade_order (
  order_id BIGINT COMMENT 'Order ID',
  user_id BIGINT COMMENT 'User ID',
  total_amount DECIMAL(12,2) COMMENT 'Total order amount',
  order_status STRING COMMENT 'Order status',
  created_at TIMESTAMP COMMENT 'Order placement time',
  dt STRING COMMENT 'Partition date'
) COMMENT 'Trade order ODS table'`

export const DDL_USER_INFO = `CREATE TABLE IF NOT EXISTS ods.ods_user_info (
  user_id BIGINT COMMENT 'User ID',
  user_name STRING COMMENT 'User name',
  gender STRING COMMENT 'Gender',
  region_code STRING COMMENT 'Region code',
  register_time TIMESTAMP COMMENT 'Registration time'
) COMMENT 'User info ODS table'`

export const DDL_DIM_REGION = `CREATE TABLE IF NOT EXISTS dim.dim_region (
  region_code STRING COMMENT 'Region code',
  region_name STRING COMMENT 'Region name',
  region_level INT COMMENT 'Region level'
) COMMENT 'Region dimension table'`

// ---------------------------------------------------------------- ETL(JOIN / GROUP BY / CTE)
export const ETL_DWD = `INSERT OVERWRITE TABLE dwd.dwd_trade_order_detail
SELECT
    o.order_id,
    o.user_id,
    u.user_name,
    u.gender,
    r.region_name,
    o.total_amount,
    o.order_status,
    o.created_at,
    o.dt
FROM ods.ods_trade_order o
JOIN ods.ods_user_info u ON o.user_id = u.user_id
LEFT JOIN dim.dim_region r ON u.region_code = r.region_code`

export const ETL_DWS = `INSERT OVERWRITE TABLE dws.dws_trade_daily_summary
SELECT
    dt,
    region_name,
    COUNT(DISTINCT order_id) AS order_cnt,
    COUNT(DISTINCT user_id) AS buyer_cnt,
    SUM(total_amount) AS gmv
FROM dwd.dwd_trade_order_detail
GROUP BY dt, region_name`

export const ETL_ADS_REPORT = `INSERT OVERWRITE TABLE ads.ads_trade_daily_report
SELECT
    dt,
    region_name,
    order_cnt,
    buyer_cnt,
    gmv,
    ROW_NUMBER() OVER (PARTITION BY dt ORDER BY gmv DESC) AS gmv_rank
FROM dws.dws_trade_daily_summary`

export const ETL_ADS_REPURCHASE = `WITH user_summary AS (
    SELECT
        user_id,
        COUNT(DISTINCT order_id) AS order_cnt,
        SUM(total_amount) AS total_gmv
    FROM dwd.dwd_trade_order_detail
    GROUP BY user_id
),
daily_avg AS (
    SELECT AVG(gmv) AS avg_daily_gmv
    FROM dws.dws_trade_daily_summary
)
INSERT OVERWRITE TABLE ads.ads_user_repurchase
SELECT
    u.user_id,
    u.order_cnt,
    u.total_gmv,
    CASE WHEN u.order_cnt >= 2 THEN 1 ELSE 0 END AS is_repurchase,
    d.avg_daily_gmv
FROM user_summary u
CROSS JOIN daily_avg d`

/** 种子脚本(顺序与后端 seed 一致:先 DDL 后 ETL) */
export const SEED_SCRIPTS: { name: string; sql_text: string }[] = [
  { name: 'ddl_ods_trade_order', sql_text: DDL_TRADE_ORDER },
  { name: 'ddl_ods_user_info', sql_text: DDL_USER_INFO },
  { name: 'ddl_dim_region', sql_text: DDL_DIM_REGION },
  { name: 'etl_dwd_trade_order_detail', sql_text: ETL_DWD },
  { name: 'etl_dws_trade_daily_summary', sql_text: ETL_DWS },
  { name: 'etl_ads_trade_daily_report', sql_text: ETL_ADS_REPORT },
  { name: 'etl_ads_user_repurchase', sql_text: ETL_ADS_REPURCHASE },
]

/** 表来源配置(管理页手工配置语义,种子期直接写入) */
export const SEED_TABLE_SOURCE: Record<string, string> = {
  'ods.ods_trade_order': 'Order Center',
  'ods.ods_user_info': 'User Center',
}

/** 表负责人 */
export const SEED_TABLE_OWNERS: Record<string, string> = {
  'ods.ods_trade_order': 'Hanson',
  'ods.ods_user_info': 'Jacky',
  'dim.dim_region': 'Jacky',
  'dwd.dwd_trade_order_detail': 'Fiona',
  'dws.dws_trade_daily_summary': 'Fiona',
  'ads.ads_trade_daily_report': 'Leo',
  'ads.ads_user_repurchase': 'Fiona',
}

// ---------------------------------------------------------------- 鉴权(与 backend/app/routers/auth.py PRESET_USERS 一致)
export const SEED_AUTH_USERS: { name: string; role: string }[] = [
  { name: 'Leo', role: 'Data Engineer' },
  { name: 'Doris', role: 'Data Engineer' },
  { name: 'Fiona', role: 'Data Analyst' },
  { name: 'Hanson', role: 'System Owner' },
  { name: 'Jacky', role: 'System Owner' },
  { name: 'Jerry', role: 'BI Engineer' },
  { name: 'Maggie', role: 'Finance Analyst' },
]

/** 演示模式统一登录密码(对齐后端 AUTH_PASSWORD 默认值) */
export const MOCK_AUTH_PASSWORD = 'lineagehub123'

// ---------------------------------------------------------------- 批量导入虚拟目录(demo 专属)
// 演示模式没有真实文件系统:任意 dir_path 都映射到这两个内置示例文件,
// SQL 文本真实走 engine 解析落库(与后端 _import_one_file 同口径,幂等)。
export const BATCH_ETL_DWD_CAMPAIGN = `-- 营销活动明细:订单按投放活动归因
INSERT OVERWRITE TABLE dwd.dwd_campaign_detail
SELECT
    o.order_id,
    o.user_id,
    u.user_name,
    r.region_name,
    CASE
        WHEN u.region_code IN ('110000', '310000') THEN 'campaign_key_city'
        ELSE 'campaign_default'
    END AS campaign_id,
    o.total_amount,
    o.dt
FROM ods.ods_trade_order o
JOIN ods.ods_user_info u ON o.user_id = u.user_id
LEFT JOIN dim.dim_region r ON u.region_code = r.region_code`

export const BATCH_ADS_CAMPAIGN_EFFECT = `-- 活动效果:按活动与分区日期汇总下单与 GMV
INSERT OVERWRITE TABLE ads.ads_campaign_effect
SELECT
    dt,
    campaign_id,
    COUNT(DISTINCT order_id) AS order_cnt,
    COUNT(DISTINCT user_id) AS buyer_cnt,
    SUM(total_amount) AS gmv
FROM dwd.dwd_campaign_detail
GROUP BY dt, campaign_id`

/** 虚拟目录文件清单:file = 相对路径(脚本名为去后缀的相对路径,同后端) */
export const BATCH_IMPORT_FILES: { file: string; sql_text: string }[] = [
  { file: 'ads/ads_campaign_effect.sql', sql_text: BATCH_ADS_CAMPAIGN_EFFECT },
  { file: 'dwd/etl_dwd_campaign.sql', sql_text: BATCH_ETL_DWD_CAMPAIGN },
]

// ---------------------------------------------------------------- 报表
export const SEED_REPORTS: {
  name: string
  table: string
  system: string
  owner: string
  owner_contact: string
  schedule: string
  description: string
}[] = [
  {
    name: 'Daily Operations Report',
    table: 'ads.ads_trade_daily_report',
    system: 'BI Platform',
    owner: 'Leo',
    owner_contact: 'leo@example.com',
    schedule: 'Daily 08:00',
    description: 'Daily core business metrics for management',
  },
  {
    name: 'Monthly Revenue Report',
    table: 'ads.ads_trade_daily_report',
    system: 'Finance System',
    owner: 'Doris',
    owner_contact: 'doris@example.com',
    schedule: 'Monthly on day 1 06:00',
    description: 'Monthly revenue report in finance terms',
  },
  {
    name: 'User Repurchase Analysis',
    table: 'ads.ads_user_repurchase',
    system: 'BI Platform',
    owner: 'Fiona',
    owner_contact: 'fiona@example.com',
    schedule: 'Daily 09:00',
    description: 'User repurchase behavior analysis dashboard',
  },
]
