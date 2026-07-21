"""集成设置读取 + SMTP 邮件通知(仅标准库 smtplib,零新增依赖)。

设置存储在 integration_settings 表(key = 'ado' / 'smtp' / 'emails',value 为 JSON);
未配置时回退到环境变量默认值,便于部署期注入。
"""
import json
import logging
import os
import smtplib
from email.header import Header
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from backend.app.models import ChangeEvent, IntegrationSetting
from backend.app.routers.auth import PRESET_USERS

logger = logging.getLogger("lineagehub.notify")

SMTP_TIMEOUT = 10  # 秒


# ---------------------------------------------------------------- 设置读写
def _env_defaults(key: str) -> dict:
    """环境变量默认配置(数据库未配置时使用)。"""
    if key == "smtp":
        return {
            "enabled": bool(os.environ.get("SMTP_HOST")),
            "host": os.environ.get("SMTP_HOST", ""),
            "port": int(os.environ.get("SMTP_PORT", "465")),
            "username": os.environ.get("SMTP_USER", ""),
            "password": os.environ.get("SMTP_PASSWORD", ""),
            "from_addr": os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "")),
            "use_tls": True,
        }
    if key == "ado":
        return {
            "enabled": bool(os.environ.get("ADO_ORG_URL")),
            "org_url": os.environ.get("ADO_ORG_URL", ""),
            "project": os.environ.get("ADO_PROJECT", ""),
            "repo": os.environ.get("ADO_REPO", ""),
            "pat": os.environ.get("ADO_PAT", ""),
            "webhook_secret": os.environ.get("ADO_WEBHOOK_SECRET", ""),
        }
    if key == "emails":
        return {}
    return {}


def load_settings(db: Session, key: str) -> dict:
    """读取集成设置;数据库无记录时返回环境变量默认值。"""
    row = db.get(IntegrationSetting, key)
    if row is not None:
        try:
            data = json.loads(row.value or "{}")
            if isinstance(data, dict):
                return data
        except Exception:  # noqa: BLE001 坏 JSON 视为未配置
            pass
    return _env_defaults(key)


def save_settings(db: Session, key: str, value: dict) -> None:
    """写入集成设置(整 key 覆盖);调用方负责 commit。"""
    row = db.get(IntegrationSetting, key)
    text = json.dumps(value, ensure_ascii=False)
    if row is None:
        db.add(IntegrationSetting(key=key, value=text))
    else:
        row.value = text
    db.flush()


# ---------------------------------------------------------------- 邮箱解析
def resolve_email(db: Session, name: str) -> str:
    """按姓名查邮箱:emails 设置优先,其次 PRESET_USERS 默认邮箱。"""
    if not name:
        return ""
    emails = load_settings(db, "emails")
    if name in emails and emails[name]:
        return emails[name]
    for u in PRESET_USERS:
        if u["name"] == name:
            return u.get("email", "")
    return ""


# ---------------------------------------------------------------- SMTP 发送
def _send_smtp(cfg: dict, to: str, subject: str, body: str) -> None:
    """实际发送邮件;失败抛异常(供 test-smtp 拿到错误详情)。"""
    host = cfg.get("host", "")
    if not host:
        raise RuntimeError("SMTP host 未配置")
    port = int(cfg.get("port") or 465)
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = cfg.get("from_addr") or cfg.get("username") or "lineagehub@localhost"
    msg["To"] = to
    if cfg.get("use_tls", True):
        server = smtplib.SMTP_SSL(host, port, timeout=SMTP_TIMEOUT)
    else:
        server = smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT)
    try:
        if cfg.get("username"):
            server.login(cfg["username"], cfg.get("password", ""))
        server.sendmail(msg["From"], [to], msg.as_string())
    finally:
        try:
            server.quit()
        except Exception:  # noqa: BLE001
            pass


def send_email(db: Session, to: str, subject: str, body: str) -> bool:
    """发送邮件;smtp.enabled 为假则记日志返回 False;任何异常都不抛出。"""
    cfg = load_settings(db, "smtp")
    if not cfg.get("enabled"):
        logger.info("SMTP 未启用,跳过邮件 -> %s: %s", to, subject)
        return False
    if not to:
        logger.warning("收件人为空,跳过邮件: %s", subject)
        return False
    try:
        _send_smtp(cfg, to, subject, body)
        logger.info("邮件已发送 -> %s: %s", to, subject)
        return True
    except Exception as exc:  # noqa: BLE001 邮件失败不影响业务流程
        logger.warning("邮件发送失败 -> %s: %s(%s)", to, subject, exc)
        return False


# ---------------------------------------------------------------- 业务通知
def _impact_summary(event: ChangeEvent) -> str:
    """从审批任务拼影响摘要(去重目标名)。"""
    names = []
    seen = set()
    for t in event.approvals:
        key = (t.target_type, t.target_name)
        if key in seen:
            continue
        seen.add(key)
        names.append(f"{t.target_type}:{t.target_name}")
    return "、".join(names) if names else "无下游影响"


def _event_code(event: ChangeEvent) -> str:
    return f"CHG-{event.id:04d}"


def notify_approvers(db: Session, event: ChangeEvent) -> int:
    """事件创建后通知全部审批人(按邮箱去重);返回成功发送数。失败静默。"""
    try:
        subject = f"[LineageHub] 变更审批待处理 {_event_code(event)}:{event.object_name}"
        body = (
            f"变更编号:{_event_code(event)}\n"
            f"变更类型:{event.change_type}\n"
            f"变更对象:{event.object_name}\n"
            f"提交人:{event.submitted_by or '未设置'}\n"
            f"影响摘要:{_impact_summary(event)}\n\n"
            "请登录 LineageHub 审批中心处理该变更。\n"
        )
        sent = 0
        seen: set = set()
        for task in event.approvals:
            email = resolve_email(db, task.approver_name)
            if not email or email in seen:
                continue
            seen.add(email)
            if send_email(db, email, subject, body):
                sent += 1
        return sent
    except Exception as exc:  # noqa: BLE001 通知失败绝不影响主流程
        logger.warning("notify_approvers 异常: %s", exc)
        return 0


def notify_submitter(db: Session, event: ChangeEvent, decision: str) -> bool:
    """审批状态流转后通知提交人审批结果。失败静默。"""
    try:
        email = resolve_email(db, event.submitted_by)
        if not email:
            return False
        subject = f"[LineageHub] 变更{('已通过' if decision == 'approved' else '被拒绝')} {_event_code(event)}:{event.object_name}"
        body = (
            f"变更编号:{_event_code(event)}\n"
            f"变更类型:{event.change_type}\n"
            f"变更对象:{event.object_name}\n"
            f"审批结果:{decision}\n\n"
            "请登录 LineageHub 查看详情。\n"
        )
        return send_email(db, email, subject, body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("notify_submitter 异常: %s", exc)
        return False
