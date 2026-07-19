"""变更与审批路由:DDL/SQL 变更申请、影响分析、审批决策状态机。"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.lineage.parser import parse_script
from backend.app.models import (
    ApprovalTask,
    ChangeEvent,
    DataTable,
    LineageEdge,
    SqlScript,
    utcnow,
)
from backend.app.schemas import (
    ApprovalListItem,
    ApprovalOut,
    ChangeDetail,
    ChangeEventOut,
    ChangeListItem,
    DdlChangeRequest,
    DecisionRequest,
    SqlChangeRequest,
)
from backend.app.service import (
    apply_change,
    create_change_event,
    event_impact,
    render_ddl,
)

router = APIRouter(prefix="/changes", tags=["changes"])
approvals_router = APIRouter(prefix="/approvals", tags=["approvals"])


def _norm_type(t: str) -> str:
    """数据类型规范化比较(忽略大小写与空白)。"""
    return "".join((t or "").split()).lower()


def _ddl_diff(table: DataTable, new_ddl: str) -> dict:
    """解析 new_ddl 并与现有字段对比,得到 diff(支持全量 DDL 与 ALTER 两种形态)。"""
    result = parse_script(new_ddl)
    current = [
        {"name": c.name, "data_type": c.data_type, "comment": c.comment}
        for c in table.columns
    ]
    # 全量字段定义:优先同名表,否则取第一份
    new_cols = None
    for name, cols in result.columns_by_table.items():
        if name == table.name:
            new_cols = cols
            break
    if new_cols is None and result.columns_by_table:
        new_cols = next(iter(result.columns_by_table.values()))

    if new_cols is not None:
        new_simple = [
            {"name": c.name, "data_type": c.data_type, "comment": c.comment}
            for c in new_cols
        ]
        return _column_diff_from_dicts(current, new_simple)

    # ALTER 形态:由操作推导 diff
    diff = {"added": [], "removed": [], "type_changed": []}
    cur_by_name = {c["name"]: c for c in current}
    for op in result.alters:
        if op.table != table.name:
            continue
        if op.op == "add" and op.column is not None:
            diff["added"].append(
                {"name": op.column.name, "data_type": op.column.data_type, "comment": op.column.comment}
            )
        elif op.op == "drop" and op.old_name:
            old = cur_by_name.get(op.old_name, {"name": op.old_name, "data_type": "", "comment": None})
            diff["removed"].append(old)
        elif op.op == "change" and op.old_name and op.column is not None:
            old = cur_by_name.get(op.old_name)
            if op.column.name != op.old_name:
                # 改名:视为删旧增新
                diff["removed"].append(old or {"name": op.old_name, "data_type": "", "comment": None})
                diff["added"].append(
                    {"name": op.column.name, "data_type": op.column.data_type, "comment": op.column.comment}
                )
            elif old and _norm_type(old["data_type"]) != _norm_type(op.column.data_type):
                diff["type_changed"].append(
                    {"name": op.old_name, "old_type": old["data_type"], "new_type": op.column.data_type}
                )
    return diff


def _column_diff_from_dicts(current: list, new: list) -> dict:
    cur = {c["name"]: c for c in current}
    new_names = {c["name"] for c in new}
    return {
        "added": [c for c in new if c["name"] not in cur],
        "removed": [c for c in current if c["name"] not in new_names],
        "type_changed": [
            {"name": c["name"], "old_type": cur[c["name"]]["data_type"], "new_type": c["data_type"]}
            for c in new
            if c["name"] in cur and _norm_type(c["data_type"]) != _norm_type(cur[c["name"]]["data_type"])
        ],
    }


def _detail(db: Session, event: ChangeEvent) -> ChangeDetail:
    impact = event_impact(db, event)
    try:
        diff = json.loads(event.diff_summary or "{}")
    except Exception:
        diff = {}
    return ChangeDetail(
        event=ChangeEventOut.model_validate(event),
        diff=diff,
        impacted_reports=impact["impacted_reports"],
        impacted_systems=impact["impacted_systems"],
        impacted_tables=impact["impacted_tables"],
        approvals=[ApprovalOut.model_validate(t) for t in event.approvals],
    )


# ---------------------------------------------------------------- 变更申请
@router.post("/ddl", response_model=ChangeDetail)
def submit_ddl_change(payload: DdlChangeRequest, db: Session = Depends(get_db)):
    """DDL 变更申请:只创建 pending 事件 + 审批任务,不应用变更。"""
    table = db.get(DataTable, payload.table_id)
    if table is None:
        raise HTTPException(404, "表不存在")
    result = parse_script(payload.new_ddl)
    if not result.columns_by_table and not result.alters:
        raise HTTPException(400, "无法从 new_ddl 解析出字段定义或 ALTER 操作")
    diff = _ddl_diff(table, payload.new_ddl)
    event = create_change_event(
        db,
        change_type="ddl_change",
        object_name=table.name,
        old_text=render_ddl(table),
        new_text=payload.new_ddl,
        diff=diff,
        submitted_by=payload.submitted_by,
        seed_table_ids=[table.id],
    )
    db.commit()
    db.refresh(event)
    return _detail(db, event)


@router.post("/sql", response_model=ChangeDetail)
def submit_sql_change(payload: SqlChangeRequest, db: Session = Depends(get_db)):
    """SQL 变更申请:diff 为血缘边新增/移除;只创建 pending 事件,不应用变更。"""
    script = db.get(SqlScript, payload.script_id)
    if script is None:
        raise HTTPException(404, "脚本不存在")

    old_pairs = {
        (e.src_table.name, e.dst_table.name)
        for e in db.query(LineageEdge).filter(LineageEdge.script_id == script.id)
    }
    result = parse_script(payload.new_sql, target_table=script.target_table)
    new_pairs = {
        (src, edge.target) for edge in result.edges for src in edge.sources
    }
    added = sorted(new_pairs - old_pairs)
    removed = sorted(old_pairs - new_pairs)
    diff = {
        "edges_added": [{"source": s, "target": d} for s, d in added],
        "edges_removed": [{"source": s, "target": d} for s, d in removed],
    }

    # 影响分析覆盖新旧两侧目标表
    old_targets = {d for _, d in old_pairs}
    target_names = old_targets | set(result.targets)
    seed_ids = [
        t.id
        for t in db.query(DataTable).filter(DataTable.name.in_(target_names)).all()
    ] if target_names else []

    event = create_change_event(
        db,
        change_type="sql_change",
        object_name=script.name,
        old_text=script.sql_text,
        new_text=payload.new_sql,
        diff=diff,
        submitted_by=payload.submitted_by,
        seed_table_ids=seed_ids,
    )
    db.commit()
    db.refresh(event)
    return _detail(db, event)


# ---------------------------------------------------------------- 查询
@router.get("", response_model=list[ChangeListItem])
def list_changes(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(ChangeEvent)
    if status:
        q = q.filter(ChangeEvent.status == status)
    events = q.order_by(ChangeEvent.created_at.desc(), ChangeEvent.id.desc()).all()
    items = []
    for ev in events:
        impacted = {(t.target_type, t.target_id) for t in ev.approvals}
        items.append(
            ChangeListItem(
                **ChangeEventOut.model_validate(ev).model_dump(),
                impact_count=len(impacted),
                pending_tasks=sum(1 for t in ev.approvals if t.status == "pending"),
                approved_tasks=sum(1 for t in ev.approvals if t.status == "approved"),
            )
        )
    return items


@router.get("/{event_id}", response_model=ChangeDetail)
def get_change(event_id: int, db: Session = Depends(get_db)):
    event = db.get(ChangeEvent, event_id)
    if event is None:
        raise HTTPException(404, "变更事件不存在")
    return _detail(db, event)


# ---------------------------------------------------------------- 审批
@approvals_router.get("", response_model=list[ApprovalListItem])
def list_approvals(
    status: Optional[str] = None,
    approver: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """审批收件箱:按状态/负责人过滤,附变更事件摘要。"""
    q = db.query(ApprovalTask)
    if status:
        q = q.filter(ApprovalTask.status == status)
    if approver:
        q = q.filter(ApprovalTask.approver_name == approver)
    tasks = q.order_by(ApprovalTask.id).all()
    items = []
    for t in tasks:
        ev = t.change_event
        items.append(
            ApprovalListItem(
                **ApprovalOut.model_validate(t).model_dump(),
                change_event={
                    "id": ev.id,
                    "change_type": ev.change_type,
                    "object_name": ev.object_name,
                    "status": ev.status,
                    "submitted_by": ev.submitted_by,
                    "created_at": ev.created_at.isoformat() if ev.created_at else None,
                },
            )
        )
    return items


@approvals_router.post("/{task_id}/decision", response_model=ChangeEventOut)
def decide(task_id: int, payload: DecisionRequest, db: Session = Depends(get_db)):
    """审批决策:任一 rejected -> 事件 rejected;全部 approved -> 事件 approved 并应用变更。"""
    task = db.get(ApprovalTask, task_id)
    if task is None:
        raise HTTPException(404, "审批任务不存在")
    if payload.decision not in ("approved", "rejected"):
        raise HTTPException(400, "decision 必须是 approved 或 rejected")
    if task.status != "pending":
        raise HTTPException(409, "该任务已决策")

    task.status = payload.decision
    task.comment = payload.comment
    task.decided_at = utcnow()

    event = task.change_event
    if event.status == "pending":
        if payload.decision == "rejected":
            event.status = "rejected"
            event.resolved_at = utcnow()
        else:
            siblings = (
                db.query(ApprovalTask)
                .filter(ApprovalTask.change_event_id == event.id)
                .all()
            )
            if all(t.status == "approved" for t in siblings):
                event.status = "approved"
                event.resolved_at = utcnow()
                apply_change(db, event)  # 应用变更(DDL 替换字段 / SQL 更新脚本与边)
    db.commit()
    db.refresh(event)
    return ChangeEventOut.model_validate(event)
