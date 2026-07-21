"""ADO Service Hook webhook:PR 创建/更新时拉取变更 SQL 文件,自动生成血缘变更审批事件。

无需登录;若已配置 webhook_secret,则要求 query 参数 secret 匹配(ADO Service Hook
的「HTTP 头/参数」能力有限,采用 URL secret 这一常见做法)。
ADO REST 调用全部使用标准库 urllib,零新增依赖。
"""
import base64
import json
import logging
import re
import urllib.parse
import urllib.request

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.lineage.parser import parse_script
from backend.app.models import ChangeEvent, DataTable, SqlScript
from backend.app.schemas import (
    CreateTableChangeRequest,
    DdlChangeRequest,
    DropTableChangeRequest,
    SqlChangeRequest,
)
from backend.app.routers import changes as changes_router
from backend.app.services import notify

logger = logging.getLogger("lineagehub.webhooks")

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

SUPPORTED_EVENT_TYPES = {"git.pullrequest.created", "git.pullrequest.updated"}

_DROP_RE = re.compile(r"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.\-]+)", re.IGNORECASE)
_CREATE_RE = re.compile(r"\bCREATE\s+TABLE\b", re.IGNORECASE)
_CTAS_RE = re.compile(r"\bCREATE\s+TABLE\b[\s\S]*?\bAS\s+SELECT\b", re.IGNORECASE)
_ALTER_RE = re.compile(r"\bALTER\s+TABLE\b", re.IGNORECASE)


# ---------------------------------------------------------------- ADO REST(标准库)
def _ado_get(url: str, pat: str) -> bytes:
    """ADO REST GET(Basic auth:空用户名 + PAT);返回原始响应体。"""
    token = base64.b64encode(f":{pat}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {token}"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def fetch_pr_sql_files(cfg: dict, pr_id: int, version: str = "") -> list:
    """拉取 PR 最新 iteration 中 add/edit 的 .sql 文件内容。

    返回 [{"path": ..., "content": ...}];单个文件拉取失败时记录并跳过。
    """
    org_url = (cfg.get("org_url") or "").rstrip("/")
    project = cfg.get("project") or ""
    repo = cfg.get("repo") or ""
    pat = cfg.get("pat") or ""
    base = f"{org_url}/{project}/_apis/git/repositories/{repo}"

    raw = _ado_get(f"{base}/pullRequests/{pr_id}/iterations?api-version=7.0", pat)
    iterations = json.loads(raw.decode("utf-8")).get("value", [])
    if not iterations:
        return []
    iteration_id = max(int(it.get("id", 0)) for it in iterations)

    raw = _ado_get(
        f"{base}/pullRequests/{pr_id}/iterations/{iteration_id}/changes?api-version=7.0",
        pat,
    )
    entries = json.loads(raw.decode("utf-8")).get("changeEntries", [])

    files = []
    for entry in entries:
        change_type = (entry.get("changeType") or "").lower()
        path = (entry.get("item") or {}).get("path") or ""
        if change_type not in ("add", "edit") or not path.lower().endswith(".sql"):
            continue
        try:
            query = {"path": path, "api-version": "7.0"}
            if version:
                query["versionDescriptor.version"] = version
            raw = _ado_get(f"{base}/items?{urllib.parse.urlencode(query)}", pat)
            files.append({"path": path, "content": raw.decode("utf-8")})
        except Exception as exc:  # noqa: BLE001 单文件失败不拖垮整个 webhook
            logger.warning("拉取 PR 文件失败 %s: %s", path, exc)
    return files


# ---------------------------------------------------------------- SQL 分类与分发
def _find_table(db: Session, name: str) -> DataTable | None:
    return db.query(DataTable).filter(DataTable.name == name.lower()).first()


def _get_or_create_script(db: Session, name: str) -> SqlScript:
    script = db.query(SqlScript).filter(SqlScript.name == name).first()
    if script is None:
        script = SqlScript(name=name, sql_type="etl", sql_text="")
        db.add(script)
        db.flush()
    return script


def _dispatch_sql(db: Session, path: str, content: str, submitted_by: str) -> ChangeEvent:
    """把单个 SQL 文本分类并复用 changes 路由逻辑创建变更事件。

    分类规则:DROP TABLE -> drop_table;CTAS / 新表 CREATE -> create_table;
    ALTER 或已存在表的 CREATE -> ddl_change;其余 DML -> sql_change。
    无法处理时抛 HTTPException(由调用方记入 skipped)。
    """
    submitted_by = submitted_by or "ado-webhook"

    # 1) DROP TABLE(可能一次删多张)
    drops = _DROP_RE.findall(content)
    if drops:
        event = None
        for name in drops:
            table = _find_table(db, name)
            if table is None:
                logger.warning("DROP TABLE 目标不存在,跳过: %s", name)
                continue
            detail = changes_router.submit_drop_table_change(
                DropTableChangeRequest(table_id=table.id, submitted_by=submitted_by), db
            )
            event = db.get(ChangeEvent, detail.event.id)
        if event is None:
            raise HTTPException(422, f"DROP TABLE 目标表均不存在:{', '.join(drops)}")
        return event

    is_ctas = bool(_CTAS_RE.search(content))
    is_create = bool(_CREATE_RE.search(content))
    is_alter = bool(_ALTER_RE.search(content))

    if is_create or is_alter:
        result = parse_script(content)
        table_names = list(result.columns_by_table.keys())
        for op in result.alters:
            if op.table not in table_names:
                table_names.append(op.table)

        # 2) CTAS / 全新表 CREATE -> create_table
        existing = [n for n in table_names if _find_table(db, n) is not None]
        if is_ctas or (is_create and not existing):
            detail = changes_router.submit_create_table_change(
                CreateTableChangeRequest(new_ddl=content, submitted_by=submitted_by), db
            )
            return db.get(ChangeEvent, detail.event.id)

        # 3) ALTER / 已存在表 CREATE -> ddl_change(每张已存在表一个事件)
        event = None
        for name in existing:
            table = _find_table(db, name)
            detail = changes_router.submit_ddl_change(
                DdlChangeRequest(table_id=table.id, new_ddl=content, submitted_by=submitted_by),
                db,
            )
            event = db.get(ChangeEvent, detail.event.id)
        if event is None:
            raise HTTPException(422, "DDL 未解析出可处理的表")
        return event

    # 4) 其他 DML(INSERT/UPDATE/MERGE 等)-> sql_change(按文件路径对应脚本)
    script = _get_or_create_script(db, path)
    detail = changes_router.submit_sql_change(
        SqlChangeRequest(script_id=script.id, new_sql=content, submitted_by=submitted_by),
        db,
    )
    return db.get(ChangeEvent, detail.event.id)


# ---------------------------------------------------------------- Webhook 端点
@router.post("/ado")
def ado_webhook(
    payload: dict = Body(...),
    secret: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    cfg = notify.load_settings(db, "ado")
    expected = cfg.get("webhook_secret") or ""
    if expected and secret != expected:
        raise HTTPException(403, "webhook secret 不匹配")

    event_type = payload.get("eventType") or ""
    if event_type not in SUPPORTED_EVENT_TYPES:
        return {"ignored": True}

    resource = payload.get("resource") or {}
    pr_id = resource.get("pullRequestId")
    if pr_id is None:
        raise HTTPException(400, "payload 缺少 resource.pullRequestId")
    submitted_by = ((resource.get("createdBy") or {}).get("displayName")) or "ado-webhook"
    version = ((resource.get("lastMergeSourceCommit") or {}).get("commitId")) or ""

    created_events: list = []
    skipped: list = []

    try:
        files = fetch_pr_sql_files(cfg, int(pr_id), version)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"ADO REST 拉取失败:{exc}")

    for f in files:
        try:
            event = _dispatch_sql(db, f["path"], f["content"], submitted_by)
            created_events.append(event.id)
            notify.notify_approvers(db, event)  # 失败静默
        except HTTPException as exc:
            db.rollback()
            skipped.append({"path": f["path"], "reason": str(exc.detail)})
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.exception("处理 PR 文件失败 %s", f["path"])
            skipped.append({"path": f["path"], "reason": str(exc)})

    return {"created_events": created_events, "skipped": skipped}
