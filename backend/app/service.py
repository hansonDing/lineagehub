"""服务层:解析结果落库、血缘边同步、变更事件与审批任务、变更应用。

解析引擎(parser.py)保持纯函数,所有数据库读写集中在 router / 本模块。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from backend.app.lineage.impact import downstream_impact
from backend.app.lineage.parser import AlterOp, ColumnInfo, ParseResult, parse_script
from backend.app.models import (
    ApprovalTask,
    ChangeEvent,
    DataTable,
    LineageEdge,
    SqlScript,
    TableColumn,
    utcnow,
)

LAYERS = ("ods", "dwd", "dws", "ads", "dim")


def infer_layer(table_name: str) -> str:
    """从表名(库名)前缀推断分层:ods/dwd/dws/ads/dim/other。"""
    prefix = (table_name or "").split(".", 1)[0].lower()
    return prefix if prefix in LAYERS else "other"


def get_or_create_table(session: Session, name: str) -> tuple:
    """按规范化全名获取或创建 DataTable,返回 (table, created)。"""
    table = session.query(DataTable).filter(DataTable.name == name).first()
    if table is not None:
        return table, False
    table = DataTable(name=name, layer=infer_layer(name))
    session.add(table)
    session.flush()
    return table, True


def replace_columns(session: Session, table: DataTable, columns: list) -> None:
    """用全量字段集替换表的现有字段(DDL 应用)。"""
    session.query(TableColumn).filter(TableColumn.table_id == table.id).delete()
    session.flush()
    for i, col in enumerate(columns):
        session.add(
            TableColumn(
                table_id=table.id,
                name=col.name,
                data_type=col.data_type,
                comment=col.comment,
                ordinal=i,
            )
        )
    table.updated_at = utcnow()
    session.flush()


def apply_alter_ops(session: Session, table: DataTable, ops: list) -> None:
    """把 ALTER 操作增量应用到表现有字段。"""
    cols = (
        session.query(TableColumn)
        .filter(TableColumn.table_id == table.id)
        .order_by(TableColumn.ordinal)
        .all()
    )
    for op in ops:
        if op.op == "add" and op.column is not None:
            if not any(c.name == op.column.name for c in cols):
                new_col = TableColumn(
                    table_id=table.id,
                    name=op.column.name,
                    data_type=op.column.data_type,
                    comment=op.column.comment,
                    ordinal=(max((c.ordinal for c in cols), default=-1) + 1),
                )
                session.add(new_col)
                cols.append(new_col)
        elif op.op == "drop" and op.old_name:
            for c in list(cols):
                if c.name == op.old_name:
                    session.delete(c)
                    cols.remove(c)
        elif op.op == "change" and op.old_name:
            for c in cols:
                if c.name == op.old_name:
                    if op.column is not None:
                        c.name = op.column.name or c.name
                        c.data_type = op.column.data_type or c.data_type
                        if op.column.comment is not None:
                            c.comment = op.column.comment
                    break
    table.updated_at = utcnow()
    session.flush()


def _merge_mapping(existing: str, new: list) -> str:
    """合并两条边同名列的映射来源(幂等更新时使用)。"""
    try:
        old = json.loads(existing or "[]")
    except Exception:
        old = []
    merged = {m.get("target_col"): m for m in old if m.get("target_col")}
    for m in new or []:
        key = m.get("target_col")
        if not key:
            continue
        if key not in merged:
            merged[key] = {"target_col": key, "sources": []}
        seen = {(s.get("table"), s.get("column")) for s in merged[key]["sources"]}
        for s in m.get("sources") or []:
            sk = (s.get("table"), s.get("column"))
            if sk not in seen:
                seen.add(sk)
                merged[key]["sources"].append(s)
    return json.dumps(list(merged.values()), ensure_ascii=False)


def _edge_pairs_of_script(session: Session, script_id: int) -> set:
    """脚本当前在库中的 (src_name, dst_name) 边集合。"""
    pairs = set()
    for e in session.query(LineageEdge).filter(LineageEdge.script_id == script_id):
        pairs.add((e.src_table.name, e.dst_table.name))
    return pairs


def sync_script_edges(session: Session, script: SqlScript, result: ParseResult) -> dict:
    """按解析结果增量同步脚本血缘边:新增新边、删除消失边、刷新保留边的列映射。

    返回 {"added": [(src, dst)...], "removed": [...], "edges_created": n}。
    """
    # 解析结果中的目标 (src_name, dst_name) 集合与映射
    desired: dict = {}
    for edge in result.edges:
        dst_table, _ = get_or_create_table(session, edge.target)
        for src_name in edge.sources:
            src_table, _ = get_or_create_table(session, src_name)
            desired[(src_table.name, dst_table.name)] = (
                src_table.id,
                dst_table.id,
                edge.column_mapping,
            )

    existing = {
        (e.src_table.name, e.dst_table.name): e
        for e in session.query(LineageEdge).filter(LineageEdge.script_id == script.id)
    }

    added, removed = [], []
    for pair, (src_id, dst_id, mapping) in desired.items():
        if pair in existing:
            # 保留边:刷新列映射
            existing[pair].column_mapping = json.dumps(mapping, ensure_ascii=False)
        else:
            session.add(
                LineageEdge(
                    src_table_id=src_id,
                    dst_table_id=dst_id,
                    script_id=script.id,
                    column_mapping=json.dumps(mapping, ensure_ascii=False),
                )
            )
            added.append(pair)
    for pair, edge in existing.items():
        if pair not in desired:
            session.delete(edge)
            removed.append(pair)
    session.flush()
    return {"added": added, "removed": removed, "edges_created": len(added)}


def persist_parse_result(session: Session, result: ParseResult, script=None) -> dict:
    """把 ParseResult 落库:注册表/字段、应用 ALTER、写入血缘边(幂等)。

    script 为 None 时仅注册表结构(不产边)。
    返回 {"tables_created": [...], "edges_created": n}。
    """
    tables_created: list = []

    def touch(name: str) -> DataTable:
        table, created = get_or_create_table(session, name)
        if created:
            tables_created.append(name)
        return table

    # 目标表与源表都注册为节点
    for name in result.targets + result.sources:
        touch(name)

    # 全量字段(CREATE)替换;ALTER 增量应用
    for name, cols in result.columns_by_table.items():
        replace_columns(session, touch(name), cols)
    alter_by_table: dict = {}
    for op in result.alters:
        alter_by_table.setdefault(op.table, []).append(op)
    for name, ops in alter_by_table.items():
        apply_alter_ops(session, touch(name), ops)

    edges_created = 0
    if script is not None:
        sync_info = sync_script_edges(session, script, result)
        edges_created = sync_info["edges_created"]
    session.flush()
    return {"tables_created": tables_created, "edges_created": edges_created}


def detect_sql_type(result: ParseResult) -> str:
    """按解析结果自动判别脚本类型:有血缘边为 etl,否则 ddl。"""
    return "etl" if result.edges else "ddl"


def render_ddl(table: DataTable) -> str:
    """由当前字段集重建规范化 DDL(作为变更事件的 old_text)。"""
    lines = []
    for c in table.columns:
        line = f"  {c.name} {c.data_type or 'STRING'}"
        if c.comment:
            line += f" COMMENT '{c.comment}'"
        lines.append(line)
    body = ",\n".join(lines)
    return f"CREATE TABLE {table.name} (\n{body}\n)"


def create_approval_tasks(session: Session, event: ChangeEvent, impact: dict) -> list:
    """按影响分析结果生成审批任务:
    报表负责人(report_owner)/ 下游系统 owner(system_owner)/ 中间表负责人(table_owner)。
    """
    tasks: list = []
    for rep in impact.get("reports", []):
        tasks.append(
            ApprovalTask(
                change_event_id=event.id,
                approver_name=rep.owner or "未设置",
                approver_role="report_owner",
                target_type="report",
                target_id=rep.id,
                target_name=rep.name,
            )
        )
    for sys_obj in impact.get("systems", []):
        tasks.append(
            ApprovalTask(
                change_event_id=event.id,
                approver_name=sys_obj.owner or "未设置",
                approver_role="system_owner",
                target_type="system",
                target_id=sys_obj.id,
                target_name=sys_obj.name,
            )
        )
    for tbl in impact.get("tables", []):
        tasks.append(
            ApprovalTask(
                change_event_id=event.id,
                approver_name=tbl.owner or "未设置",
                approver_role="table_owner",
                target_type="table",
                target_id=tbl.id,
                target_name=tbl.name,
            )
        )
    for t in tasks:
        session.add(t)
    session.flush()
    return tasks


def create_change_event(
    session: Session,
    change_type: str,
    object_name: str,
    old_text: str,
    new_text: str,
    diff: dict,
    submitted_by: str,
    seed_table_ids: list,
) -> ChangeEvent:
    """创建 pending 变更事件 + 审批任务(不应用变更)。"""
    event = ChangeEvent(
        change_type=change_type,
        object_name=object_name,
        old_text=old_text,
        new_text=new_text,
        diff_summary=json.dumps(diff, ensure_ascii=False),
        status="pending",
        submitted_by=submitted_by or "",
    )
    session.add(event)
    session.flush()
    impact = downstream_impact(session, seed_table_ids)
    create_approval_tasks(session, event, impact)
    session.flush()
    return event


def event_impact(session: Session, event: ChangeEvent) -> dict:
    """从审批任务还原事件影响面(report/system/table 分组)。"""
    reports, systems, tables = [], [], []
    for t in event.approvals:
        item = {"id": t.target_id, "name": t.target_name}
        if t.target_type == "report":
            reports.append(item)
        elif t.target_type == "system":
            systems.append(item)
        elif t.target_type == "table":
            tables.append(item)
    return {"impacted_reports": reports, "impacted_systems": systems, "impacted_tables": tables}


def apply_change(session: Session, event: ChangeEvent) -> None:
    """审批全部通过后应用变更:
    ddl_change -> 替换表字段集;sql_change -> 更新脚本并重解析边。
    """
    if event.change_type == "ddl_change":
        table = session.query(DataTable).filter(DataTable.name == event.object_name).first()
        if table is None:
            return
        result = parse_script(event.new_text)
        # 全量字段:优先匹配同名表,否则取第一份全量定义
        cols = None
        for name, c in result.columns_by_table.items():
            if name == table.name:
                cols = c
                break
        if cols is None and result.columns_by_table:
            cols = next(iter(result.columns_by_table.values()))
        if cols is not None:
            replace_columns(session, table, cols)
        elif result.alters:
            apply_alter_ops(session, table, result.alters)
    elif event.change_type == "sql_change":
        script = (
            session.query(SqlScript).filter(SqlScript.name == event.object_name).first()
        )
        if script is None:
            return
        result = parse_script(event.new_text, target_table=script.target_table)
        script.sql_text = event.new_text
        script.sql_type = detect_sql_type(result)
        script.version = (script.version or 1) + 1
        script.updated_at = utcnow()
        persist_parse_result(session, result, script=script)
    session.flush()
