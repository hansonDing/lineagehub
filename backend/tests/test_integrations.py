"""集成设置 / ADO webhook / SMTP 通知测试。

- 设置 CRUD 的鉴权与秘密字段不回传;
- webhook:monkeypatch ADO REST 拉取,断言事件创建 / secret 校验 / eventType 忽略;
- 邮件:monkeypatch smtplib.SMTP_SSL,断言审批人收到邮件,未启用时不发送。
"""
import pytest
from fastapi.testclient import TestClient

from backend.app.routers import webhooks as webhooks_module
from backend.app.services import notify as notify_module


@pytest.fixture(scope="module")
def client():
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


def _token(client, username):
    r = client.post(
        "/api/auth/login", json={"username": username, "password": "lineagehub123"}
    )
    assert r.status_code == 200
    return r.json()["token"]


def _owner_headers(client):
    return {"Authorization": f"Bearer {_token(client, 'Hanson')}"}


# ---------------------------------------------------------------- 设置 CRUD
def test_settings_require_auth(client):
    assert client.get("/api/settings/integrations").status_code == 401
    assert client.put("/api/settings/integrations", json={}).status_code == 401


def test_settings_forbidden_for_non_owner(client):
    headers = {"Authorization": f"Bearer {_token(client, 'Leo')}"}
    assert client.get("/api/settings/integrations", headers=headers).status_code == 403
    r = client.put("/api/settings/integrations", json={}, headers=headers)
    assert r.status_code == 403


def test_settings_roundtrip_and_secret_masking(client):
    headers = _owner_headers(client)
    r = client.get("/api/settings/integrations", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"ado", "smtp", "emails"}
    assert body["ado"]["pat_set"] is False
    assert body["smtp"]["password_set"] is False
    assert {e["name"] for e in body["emails"]} >= {"Leo", "Hanson"}

    payload = {
        "ado": {
            "enabled": True,
            "org_url": "https://dev.azure.com/acme",
            "project": "dw",
            "repo": "etl",
            "pat": "secret-pat-123",
            "webhook_secret": "hook-secret",
        },
        "smtp": {
            "enabled": True,
            "host": "smtp.example.com",
            "port": 465,
            "username": "bot@example.com",
            "password": "smtp-pass-456",
            "from_addr": "bot@example.com",
            "use_tls": True,
        },
        "emails": [{"name": "Leo", "email": "leo@corp.example.com"}],
    }
    r = client.put("/api/settings/integrations", json=payload, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ado"]["pat_set"] is True
    assert body["ado"]["webhook_secret_set"] is True
    assert body["smtp"]["password_set"] is True
    # 秘密字段不回传明文
    assert "secret-pat-123" not in r.text
    assert "smtp-pass-456" not in r.text
    assert "hook-secret" not in r.text
    # emails 覆盖生效
    assert {e["name"]: e["email"] for e in body["emails"]}["Leo"] == "leo@corp.example.com"

    # 空 pat/password 更新保持原值
    payload2 = {
        "ado": {"enabled": True, "org_url": "https://dev.azure.com/acme",
                "project": "dw", "repo": "etl", "pat": "", "webhook_secret": ""},
        "smtp": {"enabled": True, "host": "smtp.example.com", "port": 465,
                 "username": "bot@example.com", "password": "",
                 "from_addr": "bot@example.com", "use_tls": True},
        "emails": [],
    }
    r = client.put("/api/settings/integrations", json=payload2, headers=headers)
    assert r.status_code == 200
    assert r.json()["ado"]["pat_set"] is True
    assert r.json()["smtp"]["password_set"] is True
    assert r.json()["ado"]["webhook_secret_set"] is True


def test_test_smtp_disabled(client, monkeypatch):
    # 关闭 smtp 后 test-smtp 返回 ok=False 且不实际发送
    headers = _owner_headers(client)
    client.put(
        "/api/settings/integrations",
        json={"smtp": {"enabled": False}, "ado": {}, "emails": []},
        headers=headers,
    )
    r = client.post(
        "/api/settings/integrations/test-smtp",
        json={"to": "x@y.com"},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["ok"] is False


# ---------------------------------------------------------------- webhook
def _pr_payload():
    return {
        "eventType": "git.pullrequest.created",
        "resource": {
            "pullRequestId": 42,
            "createdBy": {"displayName": "Leo"},
            "repository": {"remoteUrl": "https://dev.azure.com/acme/dw/_git/etl"},
            "lastMergeSourceCommit": {"commitId": "abc123"},
        },
    }


def _enable_ado(client, secret="hook-secret"):
    headers = _owner_headers(client)
    client.put(
        "/api/settings/integrations",
        json={
            "ado": {"enabled": True, "org_url": "https://dev.azure.com/acme",
                    "project": "dw", "repo": "etl", "pat": "p",
                    "webhook_secret": secret},
            "smtp": {"enabled": False},
            "emails": [],
        },
        headers=headers,
    )


def test_webhook_ctas_creates_create_table_event(client, monkeypatch):
    _enable_ado(client)
    monkeypatch.setattr(
        webhooks_module,
        "fetch_pr_sql_files",
        lambda cfg, pr_id, version="": [
            {"path": "/ddl/new_table.sql",
             "content": "CREATE TABLE ads.new_t AS SELECT id FROM dwd.base_t"}
        ],
    )
    r = client.post("/api/webhooks/ado?secret=hook-secret", json=_pr_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["skipped"] == []
    assert len(body["created_events"]) == 1
    ev = client.get(f"/api/changes/{body['created_events'][0]}").json()["event"]
    assert ev["change_type"] == "create_table"
    assert ev["status"] == "pending"
    assert ev["submitted_by"] == "Leo"


def test_webhook_secret_mismatch(client):
    _enable_ado(client)
    r = client.post("/api/webhooks/ado?secret=wrong", json=_pr_payload())
    assert r.status_code == 403


def test_webhook_ignored_event_type(client):
    r = client.post(
        "/api/webhooks/ado?secret=hook-secret",
        json={"eventType": "git.push", "resource": {}},
    )
    assert r.status_code == 200
    assert r.json() == {"ignored": True}


def test_webhook_drop_unknown_table_skipped(client, monkeypatch):
    monkeypatch.setattr(
        webhooks_module,
        "fetch_pr_sql_files",
        lambda cfg, pr_id, version="": [
            {"path": "/ddl/drop.sql", "content": "DROP TABLE ads.not_exist_t"}
        ],
    )
    r = client.post("/api/webhooks/ado?secret=hook-secret", json=_pr_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["created_events"] == []
    assert len(body["skipped"]) == 1


# ---------------------------------------------------------------- 邮件通知
class _FakeSMTP:
    """记录 sendmail 调用的假 SMTP(同时兼容 SMTP 与 SMTP_SSL)。"""

    sent: list = []

    def __init__(self, *args, **kwargs):
        pass

    def login(self, *args, **kwargs):
        pass

    def sendmail(self, from_addr, to_addrs, msg):
        from email import message_from_string
        from email.header import decode_header

        parsed = message_from_string(msg)
        subject = "".join(
            part.decode(enc or "utf-8") if isinstance(part, bytes) else part
            for part, enc in decode_header(parsed.get("Subject", ""))
        )
        type(self).sent.append(
            {"from": from_addr, "to": to_addrs, "msg": msg, "subject": subject}
        )

    def quit(self):
        pass


@pytest.fixture()
def fake_smtp(monkeypatch):
    _FakeSMTP.sent = []
    monkeypatch.setattr(notify_module.smtplib, "SMTP_SSL", _FakeSMTP)
    monkeypatch.setattr(notify_module.smtplib, "SMTP", _FakeSMTP)
    return _FakeSMTP


def _set_smtp(client, enabled):
    headers = _owner_headers(client)
    client.put(
        "/api/settings/integrations",
        json={
            "ado": {"enabled": False, "webhook_secret": ""},
            "smtp": {"enabled": enabled, "host": "smtp.example.com", "port": 465,
                     "username": "bot@example.com", "from_addr": "bot@example.com",
                     "use_tls": True},
            "emails": [],
        },
        headers=headers,
    )


def _first_table_id(client):
    """挑一个有下游影响的表(全量测试时其他模块可能已改动图结构,逐表探测)。"""
    for t in client.get("/api/tables").json():
        r = client.post(
            "/api/changes/ddl",
            json={"table_id": t["id"],
                  "new_ddl": "CREATE TABLE probe (id BIGINT)",
                  "submitted_by": "Leo"},
        )
        if r.status_code == 200 and r.json()["approvals"]:
            return t["id"]
    return client.get("/api/tables").json()[0]["id"]


def test_ddl_change_notifies_approvers(client, fake_smtp):
    _set_smtp(client, True)
    table_id = _first_table_id(client)
    r = client.post(
        "/api/changes/ddl",
        json={"table_id": table_id,
              "new_ddl": "CREATE TABLE t (id BIGINT, extra_col STRING)",
              "submitted_by": "Leo"},
    )
    assert r.status_code == 200
    detail = r.json()
    approver_names = {a["approver_name"] for a in detail["approvals"]}
    assert detail["approvals"], "种子数据下应生成审批任务"
    # 每个审批人都收到邮件(默认邮箱或 emails 设置邮箱)
    sent_to = {addr for m in fake_smtp.sent for addr in m["to"]}
    expected = {
        notify_module.resolve_email(_db(client), name) for name in approver_names
    }
    assert expected <= sent_to
    assert any(
        m["subject"].startswith("[LineageHub] 变更审批待处理 CHG-")
        for m in fake_smtp.sent
    )


def test_ddl_change_smtp_disabled_no_send(client, fake_smtp):
    _set_smtp(client, False)
    table_id = _first_table_id(client)
    r = client.post(
        "/api/changes/ddl",
        json={"table_id": table_id,
              "new_ddl": "CREATE TABLE t (id BIGINT, c2 STRING)",
              "submitted_by": "Leo"},
    )
    assert r.status_code == 200  # 不发送且不报错
    assert fake_smtp.sent == []


def _db(client):
    """测试内直接查库的辅助会话。"""
    from backend.app.database import SessionLocal

    return SessionLocal()
