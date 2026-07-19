"""下游影响分析:沿 LineageEdge 有向 BFS(架构契约第 4 节)。"""
from collections import deque

from sqlalchemy.orm import Session

from backend.app.models import DataTable, LineageEdge, Report, System


def downstream_impact(session: Session, table_ids: list) -> dict:
    """从给定表出发沿血缘边有向 BFS。

    返回 {"tables": 全部下游表(不含起点), "reports": 受影响报表(去重),
          "systems": 报表目标系统(去重)}。
    报表关联范围包含变更对象本身:直接建在变更表上的报表必然受影响。
    """
    seeds = [tid for tid in dict.fromkeys(table_ids or []) if tid]

    # 邻接表:src -> [dst]
    adj: dict = {}
    for edge in session.query(LineageEdge).all():
        adj.setdefault(edge.src_table_id, []).append(edge.dst_table_id)

    visited = set(seeds)
    queue = deque(seeds)
    downstream: list = []
    while queue:
        cur = queue.popleft()
        for nxt in adj.get(cur, []):
            if nxt not in visited:
                visited.add(nxt)
                downstream.append(nxt)
                queue.append(nxt)

    tables = (
        session.query(DataTable).filter(DataTable.id.in_(downstream)).all()
        if downstream
        else []
    )

    # 报表:建在下游表或变更对象本身上的报表都受影响
    scope = set(seeds) | set(downstream)
    reports = (
        session.query(Report).filter(Report.table_id.in_(scope)).all() if scope else []
    )

    seen_sys: set = set()
    systems: list = []
    for rep in reports:
        if rep.target_system_id and rep.target_system_id not in seen_sys:
            seen_sys.add(rep.target_system_id)
            sys_obj = session.get(System, rep.target_system_id)
            if sys_obj is not None:
                systems.append(sys_obj)

    return {"tables": tables, "reports": reports, "systems": systems}
