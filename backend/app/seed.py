"""演示种子数据:电商数仓(架构契约第 5 节)。

所有 DDL 与 ETL SQL 都真实经过解析引擎生成血缘边,不手写任何边。
DB 为空时启动自动灌入。
"""
from sqlalchemy.orm import Session

from backend.app.lineage.parser import parse_script
from backend.app.models import DataTable, Report, SqlScript, System
from backend.app.service import detect_sql_type, persist_parse_result

# ---------------------------------------------------------------- 系统
SYSTEMS = [
    {"name": "Order Center", "kind": "source", "owner": "Hanson", "contact": "hanson@example.com", "description": "Transactional order business database"},
    {"name": "User Center", "kind": "source", "owner": "Jacky", "contact": "jacky@example.com", "description": "User master data database"},
    {"name": "BI Platform", "kind": "target", "owner": "Jerry", "contact": "jerry@example.com", "description": "Business analysis dashboard platform"},
    {"name": "Finance System", "kind": "target", "owner": "Maggie", "contact": "maggie@example.com", "description": "Financial accounting and reporting system"},
]

# ---------------------------------------------------------------- DDL
DDL_TRADE_ORDER = """CREATE TABLE IF NOT EXISTS ods.ods_trade_order (
  order_id BIGINT COMMENT 'Order ID',
  user_id BIGINT COMMENT 'User ID',
  total_amount DECIMAL(12,2) COMMENT 'Total order amount',
  order_status STRING COMMENT 'Order status',
  created_at TIMESTAMP COMMENT 'Order placement time',
  dt STRING COMMENT 'Partition date'
) COMMENT 'Trade order ODS table'"""

DDL_USER_INFO = """CREATE TABLE IF NOT EXISTS ods.ods_user_info (
  user_id BIGINT COMMENT 'User ID',
  user_name STRING COMMENT 'User name',
  gender STRING COMMENT 'Gender',
  region_code STRING COMMENT 'Region code',
  register_time TIMESTAMP COMMENT 'Registration time'
) COMMENT 'User info ODS table'"""

DDL_DIM_REGION = """CREATE TABLE IF NOT EXISTS dim.dim_region (
  region_code STRING COMMENT 'Region code',
  region_name STRING COMMENT 'Region name',
  region_level INT COMMENT 'Region level'
) COMMENT 'Region dimension table'"""

# ---------------------------------------------------------------- ETL(JOIN / GROUP BY / CTE)
ETL_DWD = """INSERT OVERWRITE TABLE dwd.dwd_trade_order_detail
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
LEFT JOIN dim.dim_region r ON u.region_code = r.region_code"""

ETL_DWS = """INSERT OVERWRITE TABLE dws.dws_trade_daily_summary
SELECT
    dt,
    region_name,
    COUNT(DISTINCT order_id) AS order_cnt,
    COUNT(DISTINCT user_id) AS buyer_cnt,
    SUM(total_amount) AS gmv
FROM dwd.dwd_trade_order_detail
GROUP BY dt, region_name"""

ETL_ADS_REPORT = """INSERT OVERWRITE TABLE ads.ads_trade_daily_report
SELECT
    dt,
    region_name,
    order_cnt,
    buyer_cnt,
    gmv,
    ROW_NUMBER() OVER (PARTITION BY dt ORDER BY gmv DESC) AS gmv_rank
FROM dws.dws_trade_daily_summary"""

ETL_ADS_REPURCHASE = """WITH user_summary AS (
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
CROSS JOIN daily_avg d"""

SCRIPTS = [
    ("ddl_ods_trade_order", DDL_TRADE_ORDER),
    ("ddl_ods_user_info", DDL_USER_INFO),
    ("ddl_dim_region", DDL_DIM_REGION),
    ("etl_dwd_trade_order_detail", ETL_DWD),
    ("etl_dws_trade_daily_summary", ETL_DWS),
    ("etl_ads_trade_daily_report", ETL_ADS_REPORT),
    ("etl_ads_user_repurchase", ETL_ADS_REPURCHASE),
]

# 表来源配置(管理页手工配置语义,种子期直接写入)
TABLE_SOURCE = {
    "ods.ods_trade_order": "Order Center",
    "ods.ods_user_info": "User Center",
}

# ---------------------------------------------------------------- 报表
REPORTS = [
    {"name": "Daily Operations Report", "table": "ads.ads_trade_daily_report", "system": "BI Platform",
     "owner": "Leo", "owner_contact": "leo@example.com", "schedule": "Daily 08:00",
     "description": "Daily core business metrics for management"},
    {"name": "Monthly Revenue Report", "table": "ads.ads_trade_daily_report", "system": "Finance System",
     "owner": "Doris", "owner_contact": "doris@example.com", "schedule": "Monthly on day 1 06:00",
     "description": "Monthly revenue report in finance terms"},
    {"name": "User Repurchase Analysis", "table": "ads.ads_user_repurchase", "system": "BI Platform",
     "owner": "Fiona", "owner_contact": "fiona@example.com", "schedule": "Daily 09:00",
     "description": "User repurchase behavior analysis dashboard"},
]


def seed_if_empty(db: Session) -> bool:
    """DB 为空时灌入演示数据,返回是否执行了 seed。"""
    if db.query(System).count() > 0:
        return False

    # 1. 系统
    systems = {}
    for spec in SYSTEMS:
        obj = System(**spec)
        db.add(obj)
        systems[spec["name"]] = obj
    db.flush()

    # 2. DDL + ETL 脚本:真实经过解析引擎注册表结构与血缘边
    for name, sql_text in SCRIPTS:
        result = parse_script(sql_text)
        script = SqlScript(
            name=name,
            sql_type=detect_sql_type(result),
            sql_text=sql_text,
            version=1,
        )
        db.add(script)
        db.flush()
        persist_parse_result(db, result, script=script)
    db.flush()

    # 3. 表负责人与来源系统配置
    owners = {
        "ods.ods_trade_order": "Hanson",
        "ods.ods_user_info": "Jacky",
        "dim.dim_region": "Jacky",
        "dwd.dwd_trade_order_detail": "Fiona",
        "dws.dws_trade_daily_summary": "Fiona",
        "ads.ads_trade_daily_report": "Leo",
        "ads.ads_user_repurchase": "Fiona",
    }
    for table in db.query(DataTable).all():
        table.owner = owners.get(table.name, "")
        src = TABLE_SOURCE.get(table.name)
        if src:
            table.source_system_id = systems[src].id
    db.flush()

    # 4. 报表
    for spec in REPORTS:
        table = db.query(DataTable).filter(DataTable.name == spec["table"]).first()
        db.add(
            Report(
                name=spec["name"],
                table_id=table.id,
                target_system_id=systems[spec["system"]].id,
                owner=spec["owner"],
                owner_contact=spec["owner_contact"],
                schedule=spec["schedule"],
                description=spec["description"],
            )
        )
    db.commit()
    return True
