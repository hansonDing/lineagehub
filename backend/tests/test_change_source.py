"""变更事件来源追踪测试。

- 新库启动自动带 source / source_detail 列;旧库(缺列)迁移幂等;
- ADO PR webhook 创建的事件 source=ado_pr 且 source_detail 含 pr_id/pr_url;
- 页面提交(ddl)事件 source=manual;列表/详情 API 均返回这两个字段。
"""
import os
import sqlite3
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from backend.app.database import _migrate_change_events
from backend.app.routers import webhooks as webhooks_module


@pytest.fixture(scope="module")
def client():
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------- 建表与迁移
def test_fresh_db_has_source_columns(client):
    """新库经 init_db 启动后,change_events 自带 source / source_detail 列。"""
    from backend.app.database import engine

    with engine.connect() as conn:
        cols = {
            r[1] for r in conn.execute(text("PRAGMA table_info(change_events)")).fetchall()
        }
    assert {"source", "source_detail"} <= cols


def _make_legacy_db(path: str):
    """手工建一个缺 source 列的旧版 change_events 表,并插入一条历史事件。"""
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE change_events (
            id INTEGER PRIMARY KEY,
            change_type VARCHAR NOT NULL,
            object_name VARCHAR NOT NULL,
            old_text TEXT,
            new_text TEXT,
            diff_summary TEXT,
            status VARCHAR,
            submitted_by VARCHAR,
            created_at DATETIME,
            resolved_at DATETIME
        )
        """
    )
    conn.execute(
        "INSERT INTO change_events (change_type, object_name, status) "
        "VALUES ('ddl_change', 'dwd.legacy_t', 'pending')"
    )
    conn.commit()
    conn.close()


def test_legacy_db_migration_idempotent():
    """旧库(缺列)迁移成功且幂等;历史行回填默认值 manual / '{}'。"""
    path = os.path.join(tempfile.mkdtemp(prefix="lineage_legacy_"), "legacy.db")
    _make_legacy_db(path)
    eng = create_engine(f"sqlite:///{path}")

    _migrate_change_events(eng)
    _migrate_change_events(eng)  # 第二次调用不报错(幂等)

    with eng.connect() as conn:
        cols = {
            r[1] for r in conn.execute(text("PRAGMA table_info(change_events)")).fetchall()
        }
        assert {"source", "source_detail"} <= cols
        row = conn.execute(
            text("SELECT source, source_detail FROM change_events")
        ).fetchone()
    assert row[0] == "manual"
    assert row[1] == "{}"
    eng.dispose()


# ---------------------------------------------------------------- webhook 来源
def _enable_ado(client):
    r = client.post(
        "/api/auth/login", json={"username": "Hanson", "password": "lineagehub123"}
    )
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    client.put(
        "/api/settings/integrations",
        json={
            "ado": {"enabled": True, "org_url": "https://dev.azure.com/acme",
                    "project": "dw", "repo": "etl", "pat": "p",
                    "webhook_secret": "hook-secret"},
            "smtp": {"enabled": False},
            "emails": [],
        },
        headers=headers,
    )


def _pr_payload():
    return {
        "eventType": "git.pullrequest.created",
        "resource": {
            "pullRequestId": 42,
            "title": "feat: add new table",
            "createdBy": {"displayName": "Leo"},
            "repository": {"name": "etl"},
            "sourceRefName": "refs/heads/feature/new-table",
            "lastMergeSourceCommit": {"commitId": "abc123"},
        },
    }


def test_webhook_event_source_ado_pr(client, monkeypatch):
    _enable_ado(client)
    monkeypatch.setattr(
        webhooks_module,
        "fetch_pr_sql_files",
        lambda cfg, pr_id, version="": [
            {"path": "/ddl/new_table_src.sql",
             "content": "CREATE TABLE ads.new_src_t AS SELECT id FROM dwd.base_t"}
        ],
    )
    r = client.post("/api/webhooks/ado?secret=hook-secret", json=_pr_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["skipped"] == []
    assert len(body["created_events"]) == 1

    event_id = body["created_events"][0]
    expected_detail = {
        "pr_id": 42,
        "pr_title": "feat: add new table",
        "pr_url": "https://dev.azure.com/acme/dw/_git/etl/pullrequest/42",
        "repo": "etl",
        "branch": "feature/new-table",
    }

    # 详情 API
    ev = client.get(f"/api/changes/{event_id}").json()["event"]
    assert ev["source"] == "ado_pr"
    assert ev["source_detail"] == expected_detail

    # 列表 API
    items = client.get("/api/changes").json()
    item = next(i for i in items if i["id"] == event_id)
    assert item["source"] == "ado_pr"
    assert item["source_detail"] == expected_detail

    # 清理:清空共享库中的 ado 设置,避免污染其他测试模块(如 test_integrations)
    from backend.app.database import SessionLocal
    from backend.app.services import notify as notify_module

    db = SessionLocal()
    try:
        notify_module.save_settings(db, "ado", {})
        notify_module.save_settings(db, "smtp", {})
        notify_module.save_settings(db, "emails", {})
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------- 页面提交来源
def test_manual_ddl_change_source(client):
    tables = client.get("/api/tables").json()
    assert tables
    r = client.post(
        "/api/changes/ddl",
        json={"table_id": tables[0]["id"],
              "new_ddl": "CREATE TABLE t (id BIGINT, src_probe_col STRING)",
              "submitted_by": "Leo"},
    )
    assert r.status_code == 200
    ev = r.json()["event"]
    assert ev["source"] == "manual"
    assert ev["source_detail"] == {}

    # 列表 API 同样返回 manual
    items = client.get("/api/changes").json()
    item = next(i for i in items if i["id"] == ev["id"])
    assert item["source"] == "manual"
    assert item["source_detail"] == {}
