"""演示鉴权测试:用户列表、登录成功/失败、me 验签、过期与伪造 token。"""
import time

import pytest
from fastapi.testclient import TestClient

from backend.app.routers import auth as auth_module

# 与 auth 模块默认密码一致(测试环境未设置 AUTH_PASSWORD)
DEFAULT_PASSWORD = "lineagehub123"


@pytest.fixture(scope="module")
def client():
    """模块级 TestClient:启动时自动建表 + 灌入种子数据(临时库)。"""
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


def _login(client, username="张三", password=DEFAULT_PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password})


# ---------------------------------------------------------------- 用户列表
def test_users_list(client):
    r = client.get("/api/auth/users")
    assert r.status_code == 200
    users = r.json()
    assert len(users) == 7
    by_name = {u["name"]: u["role"] for u in users}
    assert by_name == {
        "张三": "数据工程师",
        "李四": "数据工程师",
        "王五": "数据分析师",
        "赵六": "系统负责人",
        "孙七": "系统负责人",
        "周八": "BI 工程师",
        "吴九": "财务分析师",
    }
    # 不泄露密码字段
    assert all(set(u.keys()) == {"name", "role"} for u in users)


# ---------------------------------------------------------------- 登录
def test_login_success(client):
    r = _login(client, "王五")
    assert r.status_code == 200
    body = r.json()
    assert body["user"] == {"name": "王五", "role": "数据分析师"}
    # token 格式:{base64url(username)}.{issued_at}.{signature},整体必须是 ASCII(可放 HTTP 头)
    token = body["token"]
    token.encode("ascii")
    parts = token.split(".")
    assert len(parts) == 3
    assert auth_module._b64url_decode(parts[0]) == "王五"
    assert parts[1].isdigit() and parts[2]


def test_login_wrong_password(client):
    r = _login(client, "张三", "wrong-password")
    assert r.status_code == 401
    assert r.json()["detail"] == "用户名或密码错误"


def test_login_unknown_user(client):
    r = _login(client, "不存在的用户")
    assert r.status_code == 401
    assert r.json()["detail"] == "用户名或密码错误"


# ---------------------------------------------------------------- me
def test_me_valid_token(client):
    token = _login(client, "赵六").json()["token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"name": "赵六", "role": "系统负责人"}


def test_me_missing_header(client):
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_me_invalid_token(client):
    # 乱造的 token:段数/签名都不合法
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.real.token"})
    assert r.status_code == 401
    # 篡改签名:把合法 token 的签名换掉
    token = _login(client).json()["token"]
    username, issued_at, _ = token.split(".")
    forged = f"{username}.{issued_at}.{'A' * 43}"
    r2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert r2.status_code == 401


def test_me_expired_token(client):
    # 用模块内部签名函数造一个 25 小时前签发的 token(密钥与服务端一致)
    old_issued_at = str(int(time.time()) - 25 * 3600)
    signature = auth_module._sign(f"张三.{old_issued_at}")
    expired = f"{auth_module._b64url_encode('张三')}.{old_issued_at}.{signature}"
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    assert r.json()["detail"] == "token 已过期"


def test_me_non_bearer_scheme(client):
    token = _login(client).json()["token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Token {token}"})
    assert r.status_code == 401
