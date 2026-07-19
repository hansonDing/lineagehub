"""SQL 脚本与解析路由。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.lineage.parser import parse_script
from backend.app.models import DataTable, LineageEdge, SqlScript, utcnow
from backend.app.schemas import (
    ParseRequest,
    ParseResponse,
    ScriptDetail,
    ScriptListItem,
    ScriptUpdateRequest,
    ScriptUpdateResponse,
)
from backend.app.service import (
    create_change_event,
    detect_sql_type,
    persist_parse_result,
    sync_script_edges,
)

router = APIRouter(prefix="/scripts", tags=["scripts"])

# 列表页 sql_text 截断长度
LIST_SQL_PREVIEW = 200


def _to_list_item(s: SqlScript) -> ScriptListItem:
    text = s.sql_text or ""
    return ScriptListItem(
        id=s.id,
        name=s.name,
        sql_type=s.sql_type,
        sql_text=text[:LIST_SQL_PREVIEW],
        target_table=s.target_table,
        version=s.version,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@router.get("", response_model=list[ScriptListItem])
def list_scripts(db: Session = Depends(get_db)):
    """脚本列表(sql_text 截断返回)。"""
    return [_to_list_item(s) for s in db.query(SqlScript).order_by(SqlScript.id).all()]


@router.get("/{script_id}", response_model=ScriptDetail)
def get_script(script_id: int, db: Session = Depends(get_db)):
    s = db.get(SqlScript, script_id)
    if s is None:
        raise HTTPException(404, "脚本不存在")
    return s


@router.post("/parse", response_model=ParseResponse)
def parse_and_register(payload: ParseRequest, db: Session = Depends(get_db)):
    """解析 SQL 并落库:注册新表/字段、写入血缘边(幂等)。"""
    result = parse_script(payload.sql_text, target_table=payload.target_table)
    script = SqlScript(
        name=payload.name,
        sql_type=detect_sql_type(result),
        sql_text=payload.sql_text,
        target_table=payload.target_table,
        version=1,
    )
    db.add(script)
    db.flush()
    info = persist_parse_result(db, result, script=script)
    db.commit()
    return ParseResponse(
        script_id=script.id,
        target_tables=result.targets,
        source_tables=result.sources,
        tables_created=info["tables_created"],
        edges_created=info["edges_created"],
        warnings=result.warnings,
    )


@router.put("/{script_id}", response_model=ScriptUpdateResponse)
def update_script(script_id: int, payload: ScriptUpdateRequest, db: Session = Depends(get_db)):
    """更新脚本:版本+1、重解析、增量更新边;
    血缘发生变化时自动创建 sql_change 变更事件并生成审批任务。"""
    script = db.get(SqlScript, script_id)
    if script is None:
        raise HTTPException(404, "脚本不存在")

    old_sql = script.sql_text
    result = parse_script(payload.sql_text, target_table=script.target_table)

    # 记录旧目标表(影响分析需要覆盖新旧两侧)
    old_targets = {
        e.dst_table.name for e in db.query(LineageEdge).filter(LineageEdge.script_id == script.id)
    }

    script.sql_text = payload.sql_text
    script.sql_type = detect_sql_type(result)
    script.version = (script.version or 1) + 1
    script.updated_at = utcnow()
    sync_info = sync_script_edges(db, script, result)
    # 注册重解析发现的表结构(全量字段 / ALTER)
    persist_parse_result(db, result, script=None)

    change_event_id = None
    if sync_info["added"] or sync_info["removed"]:
        # 血缘发生变化 -> 自动创建 sql_change 事件(记录性质的待审批事件)
        # 影响分析覆盖新旧两侧的目标表
        target_names = old_targets | set(result.targets)
        seed_ids = [
            t.id
            for t in db.query(DataTable).filter(DataTable.name.in_(target_names)).all()
        ] if target_names else []
        diff = {
            "edges_added": [{"source": s, "target": d} for s, d in sync_info["added"]],
            "edges_removed": [{"source": s, "target": d} for s, d in sync_info["removed"]],
        }
        event = create_change_event(
            db,
            change_type="sql_change",
            object_name=script.name,
            old_text=old_sql,
            new_text=payload.sql_text,
            diff=diff,
            submitted_by="script_editor",
            seed_table_ids=seed_ids,
        )
        change_event_id = event.id

    db.commit()
    return ScriptUpdateResponse(
        script_id=script.id,
        target_tables=result.targets,
        source_tables=result.sources,
        tables_created=[],
        edges_created=sync_info["edges_created"],
        warnings=result.warnings,
        change_event_id=change_event_id,
    )


@router.delete("/{script_id}", status_code=204)
def delete_script(script_id: int, db: Session = Depends(get_db)):
    """删除脚本,同时删除其独占的血缘边。"""
    script = db.get(SqlScript, script_id)
    if script is None:
        raise HTTPException(404, "脚本不存在")
    db.query(LineageEdge).filter(LineageEdge.script_id == script.id).delete()
    db.delete(script)
    db.commit()
