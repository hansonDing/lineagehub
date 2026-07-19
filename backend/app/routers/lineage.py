"""血缘图路由:全量总览与焦点子图。"""
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import DataTable, LineageEdge, Report
from backend.app.schemas import LineageEdgeOut, LineageGraph, LineageNode

router = APIRouter(prefix="/lineage", tags=["lineage"])

OVERVIEW_NODE_LIMIT = 500


def _report_table_ids(db: Session) -> set:
    """被报表直接引用的表 id 集合。"""
    return {row[0] for row in db.query(Report.table_id).distinct().all()}


def _node_out(table: DataTable, report_ids: set) -> LineageNode:
    return LineageNode(
        id=table.id,
        name=table.name,
        layer=table.layer,
        source_system=table.source_system.name if table.source_system else None,
        owner=table.owner or "",
        is_report_source=table.id in report_ids,
    )


def _edge_out(edge: LineageEdge) -> LineageEdgeOut:
    return LineageEdgeOut(
        id=edge.id,
        source=edge.src_table_id,
        target=edge.dst_table_id,
        script_name=edge.script.name if edge.script else None,
    )


@router.get("/overview", response_model=LineageGraph)
def overview(db: Session = Depends(get_db)):
    """全量血缘图(限 500 节点)。"""
    tables = db.query(DataTable).order_by(DataTable.id).limit(OVERVIEW_NODE_LIMIT).all()
    table_ids = {t.id for t in tables}
    report_ids = _report_table_ids(db)
    edges = (
        db.query(LineageEdge)
        .filter(
            LineageEdge.src_table_id.in_(table_ids),
            LineageEdge.dst_table_id.in_(table_ids),
        )
        .all()
        if table_ids
        else []
    )
    return LineageGraph(
        nodes=[_node_out(t, report_ids) for t in tables],
        edges=[_edge_out(e) for e in edges],
    )


@router.get("/graph", response_model=LineageGraph)
def graph(
    table_id: int = Query(...),
    direction: str = Query("both", pattern="^(up|down|both|upstream|downstream)$"),
    depth: int = Query(3, ge=1, le=10),
    db: Session = Depends(get_db),
):
    """焦点子图:双向 BFS,node 增加 focus / distance(上游为负、下游为正)。"""
    focus = db.get(DataTable, table_id)
    if focus is None:
        raise HTTPException(404, "表不存在")

    edges = db.query(LineageEdge).all()
    up_adj: dict = {}  # dst -> [src](上游)
    down_adj: dict = {}  # src -> [dst](下游)
    for e in edges:
        up_adj.setdefault(e.dst_table_id, []).append(e.src_table_id)
        down_adj.setdefault(e.src_table_id, []).append(e.dst_table_id)

    distance = {table_id: 0}
    include_up = direction in ("up", "upstream", "both")
    include_down = direction in ("down", "downstream", "both")

    def bfs(adj: dict, sign: int):
        queue = deque([(table_id, 0)])
        while queue:
            cur, d = queue.popleft()
            if abs(d) >= depth:
                continue
            for nxt in adj.get(cur, []):
                if nxt not in distance:
                    distance[nxt] = d + sign
                    queue.append((nxt, d + sign))

    if include_up:
        bfs(up_adj, -1)
    if include_down:
        bfs(down_adj, 1)

    table_ids = set(distance.keys())
    tables = db.query(DataTable).filter(DataTable.id.in_(table_ids)).all()
    report_ids = _report_table_ids(db)
    sub_edges = [
        e for e in edges if e.src_table_id in table_ids and e.dst_table_id in table_ids
    ]

    nodes = []
    for t in tables:
        node = _node_out(t, report_ids)
        node.focus = t.id == table_id
        node.distance = distance[t.id]
        nodes.append(node)
    return LineageGraph(nodes=nodes, edges=[_edge_out(e) for e in sub_edges])
