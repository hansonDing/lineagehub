"""演示级假登录鉴权:预设用户 + HMAC 签名 token(只守门,不逐点鉴权)。

- 预设 7 个用户(与种子数据负责人一致),统一密码由环境变量 AUTH_PASSWORD 控制;
- token 格式 ``{base64url(username)}.{issued_at}.{signature}``,
  其中 signature = base64url(HMAC-SHA256(AUTH_SECRET, username + "." + issued_at)),
  issued_at 为 Unix 秒时间戳,有效期 24 小时;
  (用户名可能含非 ASCII 字符,直接放进 token 会违反 HTTP 头 ASCII 约束,故首段统一做 base64url 编码)
- 本模块只提供登录/验签端点,既有业务端点不做鉴权(演示定位)。
"""
import base64
import hashlib
import hmac
import os
import time

from fastapi import APIRouter, Header, HTTPException

from backend.app.schemas import AuthUser, LoginRequest, LoginResponse

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------- 配置
# token 有效期:24 小时(秒)
TOKEN_TTL_SECONDS = 24 * 3600

# 预设用户:与种子数据(系统/表/报表负责人)保持一致
def _default_email(name: str) -> str:
    """预设用户默认邮箱:{姓名小写}@lineagehub.example.com。"""
    return f"{name.lower()}@lineagehub.example.com"


PRESET_USERS: list[dict] = [
    {"name": "Leo", "role": "Data Engineer", "email": _default_email("Leo")},
    {"name": "Doris", "role": "Data Engineer", "email": _default_email("Doris")},
    {"name": "Fiona", "role": "Data Analyst", "email": _default_email("Fiona")},
    {"name": "Hanson", "role": "System Owner", "email": _default_email("Hanson")},
    {"name": "Jacky", "role": "System Owner", "email": _default_email("Jacky")},
    {"name": "Jerry", "role": "BI Engineer", "email": _default_email("Jerry")},
    {"name": "Maggie", "role": "Finance Analyst", "email": _default_email("Maggie")},
]

# 统一错误文案:用户不存在与密码错误不区分(避免枚举用户)
_LOGIN_FAIL_DETAIL = "用户名或密码错误"


def _password() -> str:
    """统一登录密码:环境变量 AUTH_PASSWORD,默认 lineagehub123。"""
    return os.environ.get("AUTH_PASSWORD", "lineagehub123")


def _secret() -> str:
    """token 签名密钥:环境变量 AUTH_SECRET,默认开发密钥(生产必须覆盖)。"""
    return os.environ.get("AUTH_SECRET", "lineagehub-dev-secret-请勿用于生产")


def _find_user(username: str) -> dict | None:
    """按姓名查预设用户。"""
    for u in PRESET_USERS:
        if u["name"] == username:
            return u
    return None


def _sign(message: str) -> str:
    """对消息做 HMAC-SHA256 并 base64url 编码(去填充,便于放在 token 里)。"""
    digest = hmac.new(_secret().encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _b64url_encode(text: str) -> str:
    """UTF-8 字符串 -> base64url(去填充),保证 token 段为 ASCII。"""
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def _b64url_decode(segment: str) -> str:
    """base64url(可缺填充)-> UTF-8 字符串;非法输入抛异常。"""
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding).decode("utf-8")


def _issue_token(username: str) -> str:
    """签发 token:{base64url(username)}.{issued_at}.{base64url(hmac_sha256(secret, username.issued_at))}。"""
    issued_at = str(int(time.time()))
    signature = _sign(f"{username}.{issued_at}")
    return f"{_b64url_encode(username)}.{issued_at}.{signature}"


def _verify_token(token: str) -> dict:
    """验签 + 有效期校验,成功返回用户;失败抛 401。"""
    parts = (token or "").split(".")
    if len(parts) != 3 or not all(parts):
        raise HTTPException(401, "无效的 token")
    username_b64, issued_at, signature = parts
    try:
        username = _b64url_decode(username_b64)
    except Exception:  # noqa: BLE001 base64/UTF-8 解码失败一律视为伪造
        raise HTTPException(401, "无效的 token")
    # 恒定时间比较防时序攻击
    expected = _sign(f"{username}.{issued_at}")
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(401, "无效的 token")
    try:
        issued_ts = int(issued_at)
    except ValueError:
        raise HTTPException(401, "无效的 token")
    if time.time() - issued_ts > TOKEN_TTL_SECONDS:
        raise HTTPException(401, "token 已过期")
    user = _find_user(username)
    if user is None:
        raise HTTPException(401, "无效的 token")
    return user


def verify_bearer_token(authorization: str | None) -> dict:
    """从 Authorization 头解析并验证 Bearer token(供其他路由复用)。

    缺失/非 Bearer 抛 401「缺少 Authorization 头」;无效/过期抛 401。
    成功返回 PRESET_USERS 中的用户 dict(name/role/email)。
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "缺少 Authorization 头")
    token = authorization[len("Bearer "):].strip()
    return _verify_token(token)


# ---------------------------------------------------------------- 端点
@router.get("/users", response_model=list[AuthUser])
def list_users():
    """预设用户列表(姓名 + 角色),供登录页展示,不含密码。"""
    return [AuthUser(**u) for u in PRESET_USERS]


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest):
    """登录:用户不存在或密码错误均返回 401;成功返回 token + 用户信息。"""
    user = _find_user(payload.username)
    if user is None or payload.password != _password():
        raise HTTPException(401, _LOGIN_FAIL_DETAIL)
    return LoginResponse(token=_issue_token(user["name"]), user=AuthUser(**user))


@router.get("/me", response_model=AuthUser)
def me(authorization: str | None = Header(default=None)):
    """按 Bearer token 返回当前用户;缺失/无效/过期均 401。"""
    user = verify_bearer_token(authorization)
    return AuthUser(**user)
