"""集成设置路由:ADO / SMTP / 邮箱映射 的读写与连通性测试。

仅 System Owner 角色可访问(401 无 token,403 非管理员);
PAT / SMTP 密码 / webhook secret 永不回传明文,只回 xxx_set 标记。
"""
import base64
import json
import urllib.request

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.routers.auth import PRESET_USERS, verify_bearer_token
from backend.app.services import notify

router = APIRouter(prefix="/settings", tags=["settings"])

SECRET_KEYS = (("ado", "pat"), ("ado", "webhook_secret"), ("smtp", "password"))


# ---------------------------------------------------------------- 依赖与模型
def require_system_owner(authorization: str | None = Header(default=None)) -> dict:
    """仅 System Owner 可访问集成设置。"""
    user = verify_bearer_token(authorization)
    if user.get("role") != "System Owner":
        raise HTTPException(403, "仅 System Owner 可管理集成设置")
    return user


class AdoSettingsIn(BaseModel):
    enabled: bool = False
    org_url: str = ""
    project: str = ""
    repo: str = ""
    pat: str = ""  # 空字符串 = 保持原值
    webhook_secret: str = ""  # 空字符串 = 保持原值


class SmtpSettingsIn(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 465
    username: str = ""
    password: str = ""  # 空字符串 = 保持原值
    from_addr: str = ""
    use_tls: bool = True


class EmailMappingIn(BaseModel):
    name: str
    email: str


class IntegrationsIn(BaseModel):
    ado: AdoSettingsIn = AdoSettingsIn()
    smtp: SmtpSettingsIn = SmtpSettingsIn()
    emails: list[EmailMappingIn] = []


class TestSmtpIn(BaseModel):
    to: str


# ---------------------------------------------------------------- 序列化
def _public_view(db: Session) -> dict:
    """组装对外视图:秘密字段只给 xxx_set 布尔,不回传明文。"""
    ado = notify.load_settings(db, "ado")
    smtp = notify.load_settings(db, "smtp")
    emails_map = notify.load_settings(db, "emails")
    # emails:设置覆盖优先;未覆盖的预设用户也列出默认邮箱,便于页面展示
    names = [u["name"] for u in PRESET_USERS]
    for name in emails_map:
        if name not in names:
            names.append(name)
    defaults = {u["name"]: u.get("email", "") for u in PRESET_USERS}
    emails = [
        {"name": n, "email": emails_map.get(n) or defaults.get(n, "")} for n in names
    ]
    return {
        "ado": {
            "enabled": bool(ado.get("enabled")),
            "org_url": ado.get("org_url", ""),
            "project": ado.get("project", ""),
            "repo": ado.get("repo", ""),
            "pat_set": bool(ado.get("pat")),
            "webhook_secret_set": bool(ado.get("webhook_secret")),
        },
        "smtp": {
            "enabled": bool(smtp.get("enabled")),
            "host": smtp.get("host", ""),
            "port": int(smtp.get("port") or 465),
            "username": smtp.get("username", ""),
            "password_set": bool(smtp.get("password")),
            "from_addr": smtp.get("from_addr", ""),
            "use_tls": bool(smtp.get("use_tls", True)),
        },
        "emails": emails,
    }


# ---------------------------------------------------------------- 端点
@router.get("/integrations")
def get_integrations(
    db: Session = Depends(get_db), _: dict = Depends(require_system_owner)
):
    return _public_view(db)


@router.put("/integrations")
def put_integrations(
    payload: IntegrationsIn,
    db: Session = Depends(get_db),
    _: dict = Depends(require_system_owner),
):
    """整体更新集成设置;pat/password/webhook_secret 传空字符串表示保持原值。"""
    old_ado = notify.load_settings(db, "ado")
    old_smtp = notify.load_settings(db, "smtp")

    ado = payload.ado.model_dump()
    if not ado.get("pat"):
        ado["pat"] = old_ado.get("pat", "")
    if not ado.get("webhook_secret"):
        ado["webhook_secret"] = old_ado.get("webhook_secret", "")

    smtp = payload.smtp.model_dump()
    if not smtp.get("password"):
        smtp["password"] = old_smtp.get("password", "")

    emails = {e.name: e.email for e in payload.emails if e.name}

    notify.save_settings(db, "ado", ado)
    notify.save_settings(db, "smtp", smtp)
    notify.save_settings(db, "emails", emails)
    db.commit()
    return _public_view(db)


@router.post("/integrations/test-smtp")
def test_smtp(
    payload: TestSmtpIn,
    db: Session = Depends(get_db),
    _: dict = Depends(require_system_owner),
):
    """用当前存储的 SMTP 配置实际发一封测试邮件。"""
    cfg = notify.load_settings(db, "smtp")
    if not cfg.get("enabled"):
        return {"ok": False, "detail": "SMTP 未启用(enabled=false)"}
    try:
        notify._send_smtp(
            cfg,
            payload.to,
            "[LineageHub] SMTP 测试邮件",
            "这是一封来自 LineageHub 集成设置的测试邮件。",
        )
        return {"ok": True, "detail": f"测试邮件已发送至 {payload.to}"}
    except Exception as exc:  # noqa: BLE001 把错误详情返回给配置页
        return {"ok": False, "detail": str(exc)}


def ado_repo_check(cfg: dict) -> dict:
    """用存储的 ADO 配置调仓库元数据 API 验证连通性(Basic auth: 空用户名 + PAT)。"""
    org_url = (cfg.get("org_url") or "").rstrip("/")
    project = cfg.get("project") or ""
    repo = cfg.get("repo") or ""
    pat = cfg.get("pat") or ""
    if not all([org_url, project, repo, pat]):
        return {"ok": False, "detail": "ADO 配置不完整(org_url/project/repo/pat)"}
    url = f"{org_url}/{project}/_apis/git/repositories/{repo}?api-version=7.0"
    token = base64.b64encode(f":{pat}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return {"ok": True, "detail": f"连接成功:{data.get('name', repo)}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "detail": str(exc)}


@router.post("/integrations/test-ado")
def test_ado(
    db: Session = Depends(get_db), _: dict = Depends(require_system_owner)
):
    cfg = notify.load_settings(db, "ado")
    return ado_repo_check(cfg)
