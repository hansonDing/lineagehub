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
  { name: '订单中心', kind: 'source', owner: '赵六', contact: 'zhaoliu@example.com', description: '交易订单业务库' },
  { name: '用户中心', kind: 'source', owner: '孙七', contact: 'sunqi@example.com', description: '用户主数据业务库' },
  { name: 'BI 平台', kind: 'target', owner: '周八', contact: 'zhouba@example.com', description: '经营分析看板平台' },
  { name: '财务系统', kind: 'target', owner: '吴九', contact: 'wujiu@example.com', description: '财务核算与报表系统' },
]

// ---------------------------------------------------------------- DDL
export const DDL_TRADE_ORDER = `CREATE TABLE IF NOT EXISTS ods.ods_trade_order (
  order_id BIGINT COMMENT '订单ID',
  user_id BIGINT COMMENT '用户ID',
  total_amount DECIMAL(12,2) COMMENT '订单总金额',
  order_status STRING COMMENT '订单状态',
  created_at TIMESTAMP COMMENT '下单时间',
  dt STRING COMMENT '分区日期'
) COMMENT '交易订单ODS表'`

export const DDL_USER_INFO = `CREATE TABLE IF NOT EXISTS ods.ods_user_info (
  user_id BIGINT COMMENT '用户ID',
  user_name STRING COMMENT '用户名',
  gender STRING COMMENT '性别',
  region_code STRING COMMENT '地区编码',
  register_time TIMESTAMP COMMENT '注册时间'
) COMMENT '用户信息ODS表'`

export const DDL_DIM_REGION = `CREATE TABLE IF NOT EXISTS dim.dim_region (
  region_code STRING COMMENT '地区编码',
  region_name STRING COMMENT '地区名称',
  region_level INT COMMENT '地区层级'
) COMMENT '地区维表'`

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
  'ods.ods_trade_order': '订单中心',
  'ods.ods_user_info': '用户中心',
}

/** 表负责人 */
export const SEED_TABLE_OWNERS: Record<string, string> = {
  'ods.ods_trade_order': '赵六',
  'ods.ods_user_info': '孙七',
  'dim.dim_region': '孙七',
  'dwd.dwd_trade_order_detail': '王五',
  'dws.dws_trade_daily_summary': '王五',
  'ads.ads_trade_daily_report': '张三',
  'ads.ads_user_repurchase': '王五',
}

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
    name: '经营日报',
    table: 'ads.ads_trade_daily_report',
    system: 'BI 平台',
    owner: '张三',
    owner_contact: 'zhangsan@example.com',
    schedule: '每日 08:00',
    description: '面向管理层的每日经营核心指标',
  },
  {
    name: '财务收入月报',
    table: 'ads.ads_trade_daily_report',
    system: '财务系统',
    owner: '李四',
    owner_contact: 'lisi@example.com',
    schedule: '每月 1 日 06:00',
    description: '财务口径收入月报',
  },
  {
    name: '用户复购分析',
    table: 'ads.ads_user_repurchase',
    system: 'BI 平台',
    owner: '王五',
    owner_contact: 'wangwu@example.com',
    schedule: '每日 09:00',
    description: '用户复购行为分析看板',
  },
]
