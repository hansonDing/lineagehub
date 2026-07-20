"""API 冒烟测试:种子数据、解析落库、血缘图、变更审批状态机(approve/reject)。"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """模块级 TestClient:启动时自动建表 + 灌入种子数据(临时库)。"""
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


def _table_id(client, name):
    for t in client.get("/api/tables").json():
        if t["name"] == name:
            return t["id"]
    raise AssertionError(f"表 {name} 不存在")


def _event_tasks(client, event_id, status="pending"):
    return [
        t
        for t in client.get(f"/api/approvals?status={status}").json()
        if t["change_event"]["id"] == event_id
    ]


# ---------------------------------------------------------------- 种子数据
def test_seed_dashboard_stats(client):
    stats = client.get("/api/dashboard/stats").json()
    assert stats["table_count"] == 7
    assert stats["report_count"] == 3
    assert stats["system_count"] == 4
    assert stats["edge_count"] == 7  # 3(dwd) + 1(dws) + 1(ads日报) + 2(ads复购)
    layers = {d["layer"]: d["count"] for d in stats["layer_distribution"]}
    assert layers == {"ods": 2, "dim": 1, "dwd": 1, "dws": 1, "ads": 2}
    assert stats["pending_changes"] == 0
    # 热门表:ods 订单表下游 4 张(dwd/dws/ads日报/ads复购)
    hot = {h["name"]: h["downstream"] for h in stats["hot_tables"]}
    assert hot["ods.ods_trade_order"] == 4


def test_seed_tables_and_reports(client):
    tables = {t["name"]: t for t in client.get("/api/tables").json()}
    assert tables["ods.ods_trade_order"]["source_system_name"] == "订单中心"
    assert tables["ods.ods_user_info"]["source_system_name"] == "用户中心"
    assert tables["dwd.dwd_trade_order_detail"]["column_count"] == 0  # ETL 目标无 DDL 字段
    detail = client.get(f"/api/tables/{_table_id(client, 'ods.ods_trade_order')}").json()
    assert [c["name"] for c in detail["columns"]][:3] == ["order_id", "user_id", "total_amount"]
    reports = {r["name"]: r for r in client.get("/api/reports").json()}
    assert reports["经营日报"]["target_system_name"] == "BI 平台"
    assert reports["财务收入月报"]["target_system_name"] == "财务系统"
    assert reports["用户复购分析"]["table_name"] == "ads.ads_user_repurchase"


# ---------------------------------------------------------------- 解析
def test_parse_endpoint_new_ctas(client):
    payload = {
        "name": "etl_ads_region_rank",
        "sql_text": "CREATE TABLE ads.ads_region_rank AS "
        "SELECT dt, region_name, gmv FROM dws.dws_trade_daily_summary "
        "WHERE dt = '2024-01-01'",
    }
    r = client.post("/api/scripts/parse", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["target_tables"] == ["ads.ads_region_rank"]
    assert body["source_tables"] == ["dws.dws_trade_daily_summary"]
    assert "ads.ads_region_rank" in body["tables_created"]
    assert body["edges_created"] == 1
    # 列表截断、详情完整
    item = [s for s in client.get("/api/scripts").json() if s["id"] == body["script_id"]][0]
    assert item["sql_type"] == "etl"
    full = client.get(f"/api/scripts/{body['script_id']}").json()
    assert "ads_region_rank" in full["sql_text"]


def test_parse_bare_select_requires_target(client):
    r = client.post("/api/scripts/parse", json={"name": "bad", "sql_text": "SELECT 1 FROM ods.x"})
    assert any("target_table" in w for w in r.json()["warnings"])


# ---------------------------------------------------------------- 血缘图
def test_lineage_overview(client):
    g = client.get("/api/lineage/overview").json()
    names = {n["name"] for n in g["nodes"]}
    assert "ods.ods_trade_order" in names and "ads.ads_user_repurchase" in names
    assert len(g["edges"]) >= 8
    e0 = g["edges"][0]
    assert set(e0.keys()) == {"id", "source", "target", "script_name"}
    n0 = [n for n in g["nodes"] if n["name"] == "ads.ads_trade_daily_report"][0]
    assert n0["is_report_source"] is True


def test_lineage_graph_focus(client):
    tid = _table_id(client, "dwd.dwd_trade_order_detail")
    g = client.get(f"/api/lineage/graph?table_id={tid}&direction=both&depth=3").json()
    by_name = {n["name"]: n for n in g["nodes"]}
    assert by_name["dwd.dwd_trade_order_detail"]["focus"] is True
    assert by_name["ods.ods_trade_order"]["distance"] == -1  # 上游为负
    assert by_name["dws.dws_trade_daily_summary"]["distance"] == 1  # 下游为正
    assert by_name["ads.ads_trade_daily_report"]["distance"] == 2
    # 只看上游
    g2 = client.get(f"/api/lineage/graph?table_id={tid}&direction=upstream").json()
    assert all(n["distance"] <= 0 for n in g2["nodes"])


# ---------------------------------------------------------------- 变更审批:approve 全通过才应用
def test_ddl_change_full_approve_applies(client):
    tid = _table_id(client, "ods.ods_trade_order")
    r = client.post(
        "/api/changes/ddl",
        json={
            "table_id": tid,
            "new_ddl": "ALTER TABLE ods.ods_trade_order ADD COLUMNS (pay_channel STRING COMMENT '支付渠道')",
            "submitted_by": "Hanson",
        },
    )
    assert r.status_code == 200
    detail = r.json()
    event = detail["event"]
    assert event["status"] == "pending" and event["change_type"] == "ddl_change"
    # 影响面:经营日报等 3 张报表 + 2 个系统 + 下游表(dwd/dws/ads日报/ads复购 等)
    assert {x["name"] for x in detail["impacted_reports"]} == {"经营日报", "财务收入月报", "用户复购分析"}
    assert {x["name"] for x in detail["impacted_systems"]} == {"BI 平台", "财务系统"}
    assert {"dwd.dwd_trade_order_detail", "dws.dws_trade_daily_summary",
            "ads.ads_trade_daily_report", "ads.ads_user_repurchase"} <= {
        x["name"] for x in detail["impacted_tables"]
    }
    # diff:新增一列
    assert [c["name"] for c in detail["diff"]["added"]] == ["pay_channel"]
    # 任务数 = 报表 + 系统 + 中间表(每受影响负责人一条)
    tasks = _event_tasks(client, event["id"])
    expected = (
        len(detail["impacted_reports"])
        + len(detail["impacted_systems"])
        + len(detail["impacted_tables"])
    )
    assert len(tasks) == expected
    for t in tasks[:-1]:
        client.post(f"/api/approvals/{t['id']}/decision", json={"decision": "approved"})
    mid = client.get(f"/api/changes/{event['id']}").json()
    assert mid["event"]["status"] == "pending"  # 还差一个
    cols_before = [c["name"] for c in client.get(f"/api/tables/{tid}").json()["columns"]]
    assert "pay_channel" not in cols_before
    # 最后一个 approve -> 事件通过并应用变更
    last = client.post(
        f"/api/approvals/{tasks[-1]['id']}/decision",
        json={"decision": "approved", "comment": "同意"},
    ).json()
    assert last["status"] == "approved"
    cols_after = [c["name"] for c in client.get(f"/api/tables/{tid}").json()["columns"]]
    assert "pay_channel" in cols_after
    # 已决策任务不可重复决策
    again = client.post(f"/api/approvals/{tasks[-1]['id']}/decision", json={"decision": "approved"})
    assert again.status_code == 409


# ---------------------------------------------------------------- 变更审批:任一 reject 即拒绝
def test_ddl_change_any_reject_blocks(client):
    tid = _table_id(client, "dim.dim_region")
    r = client.post(
        "/api/changes/ddl",
        json={
            "table_id": tid,
            "new_ddl": "CREATE TABLE dim.dim_region (region_code STRING COMMENT '地区编码', region_name STRING COMMENT '地区名称')",
            "submitted_by": "Jacky",
        },
    )
    detail = r.json()
    event = detail["event"]
    assert [c["name"] for c in detail["diff"]["removed"]] == ["region_level"]
    tasks = _event_tasks(client, event["id"])
    assert len(tasks) > 0
    client.post(f"/api/approvals/{tasks[0]['id']}/decision", json={"decision": "approved"})
    last = client.post(
        f"/api/approvals/{tasks[1]['id']}/decision",
        json={"decision": "rejected", "comment": "不同意删列"},
    ).json()
    assert last["status"] == "rejected"
    # 变更未被应用:region_level 仍在
    cols = [c["name"] for c in client.get(f"/api/tables/{tid}").json()["columns"]]
    assert "region_level" in cols


# ---------------------------------------------------------------- SQL 变更:PUT 自动建事件 + changes/sql 审批后应用
def test_put_script_auto_creates_sql_change(client):
    scripts = {s["name"]: s for s in client.get("/api/scripts").json()}
    sid = scripts["etl_dws_trade_daily_summary"]["id"]
    new_sql = (
        "INSERT OVERWRITE TABLE dws.dws_trade_daily_summary "
        "SELECT d.dt, d.region_name, COUNT(DISTINCT d.order_id) AS order_cnt, "
        "COUNT(DISTINCT d.user_id) AS buyer_cnt, SUM(d.total_amount) AS gmv "
        "FROM dwd.dwd_trade_order_detail d "
        "LEFT JOIN dim.dim_region r ON d.region_name = r.region_name "
        "GROUP BY d.dt, d.region_name"
    )
    r = client.put(f"/api/scripts/{sid}", json={"sql_text": new_sql})
    assert r.status_code == 200
    body = r.json()
    assert body["change_event_id"] is not None  # 血缘变化 -> 自动事件
    detail = client.get(f"/api/changes/{body['change_event_id']}").json()
    assert detail["event"]["change_type"] == "sql_change"
    assert {"source": "dim.dim_region", "target": "dws.dws_trade_daily_summary"} in detail["diff"]["edges_added"]
    # 脚本已升级
    assert client.get(f"/api/scripts/{sid}").json()["version"] == 2


def test_sql_change_applied_after_full_approve(client):
    scripts = {s["name"]: s for s in client.get("/api/scripts").json()}
    sid = scripts["etl_ads_trade_daily_report"]["id"]
    # 新 SQL 改为直接读 dwd(血缘边发生变化:dwd->ads 新增、dws->ads 移除)
    new_sql = (
        "INSERT OVERWRITE TABLE ads.ads_trade_daily_report "
        "SELECT dt, region_name, COUNT(DISTINCT order_id) AS order_cnt, "
        "COUNT(DISTINCT user_id) AS buyer_cnt, SUM(total_amount) AS gmv "
        "FROM dwd.dwd_trade_order_detail GROUP BY dt, region_name"
    )
    r = client.post("/api/changes/sql", json={"script_id": sid, "new_sql": new_sql, "submitted_by": "Leo"})
    detail = r.json()
    event = detail["event"]
    assert event["status"] == "pending"
    assert {"source": "dwd.dwd_trade_order_detail", "target": "ads.ads_trade_daily_report"} in detail["diff"]["edges_added"]
    assert {"source": "dws.dws_trade_daily_summary", "target": "ads.ads_trade_daily_report"} in detail["diff"]["edges_removed"]
    # 未应用前脚本仍是旧版本
    assert "gmv_rank" in client.get(f"/api/scripts/{sid}").json()["sql_text"]
    for t in _event_tasks(client, event["id"]):
        client.post(f"/api/approvals/{t['id']}/decision", json={"decision": "approved"})
    done = client.get(f"/api/changes/{event['id']}").json()
    assert done["event"]["status"] == "approved"
    updated = client.get(f"/api/scripts/{sid}").json()
    assert "gmv_rank" not in updated["sql_text"]
    assert updated["version"] == 2
    # 边已切换
    g = client.get("/api/lineage/overview").json()
    pairs = {(e["source"], e["target"]) for e in g["edges"]}
    dwd_id = _table_id(client, "dwd.dwd_trade_order_detail")
    ads_id = _table_id(client, "ads.ads_trade_daily_report")
    assert (dwd_id, ads_id) in pairs


# ---------------------------------------------------------------- 审批收件箱与删除脚本
def test_approvals_inbox_filter(client):
    items = client.get("/api/approvals?status=pending").json()
    for it in items:
        assert it["status"] == "pending"
        assert {"id", "change_type", "object_name", "status", "submitted_by", "created_at"} <= set(it["change_event"].keys())
    leo = client.get("/api/approvals?approver=Leo").json()
    assert all(t["approver_name"] == "Leo" for t in leo)


def test_delete_script_removes_edges(client):
    r = client.post(
        "/api/scripts/parse",
        json={"name": "tmp_etl", "sql_text": "INSERT OVERWRITE TABLE ads.tmp_t SELECT id FROM ods.ods_trade_order"},
    )
    sid = r.json()["script_id"]
    assert client.delete(f"/api/scripts/{sid}").status_code == 204
    g = client.get("/api/lineage/overview").json()
    assert not any(e["script_name"] == "tmp_etl" for e in g["edges"])
