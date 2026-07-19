"""仪表盘统计路由。"""
from collections import deque

from sqlalchemy import func
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from backend.app.database import get_db
from backend.app.models import (
    ApprovalTask,
    ChangeEvent,
    DataTable,
    LineageEdge,
    Report,
    System,
)
from backend.app.schemas import DashboardStats, HotTable, LayerCount

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _downstream_count(adj: dict, start: int) -> int:
    """从 start 出发的可达下游表数量(BFS)。"""
    visited = {start}
    queue = deque([start])
    n = 0
    while queue:
        cur = queue.popleft()
        for nxt in adj.get(cur, []):
            if nxt not in visited:
                visited.add(nxt)
                n += 1
                queue.append(nxt)
    return n


@router.get("/stats", response_model=DashboardStats)
def stats(db: Session = Depends(get_db)):
    table_count = db.query(func.count(DataTable.id)).scalar() or 0
    report_count = db.query(func.count(Report.id)).scalar() or 0
    system_count = db.query(func.count(System.id)).scalar() or 0
    edge_count = db.query(func.count(LineageEdge.id)).scalar() or 0
    pending_changes = (
        db.query(func.count(ChangeEvent.id)).filter(ChangeEvent.status == "pending").scalar() or 0
    )
    pending_approvals = (
        db.query(func.count(ApprovalTask.id)).filter(ApprovalTask.status == "pending").scalar() or 0
    )

    layer_rows = (
        db.query(DataTable.layer, func.count(DataTable.id))
        .group_by(DataTable.layer)
        .order_by(DataTable.layer)
        .all()
    )
    layer_distribution = [LayerCount(layer=l, count=c) for l, c in layer_rows]

    recent = db.query(ChangeEvent).order_by(ChangeEvent.created_at.desc(), ChangeEvent.id.desc()).limit(5).all()
    recent_changes = [
        {
            "id": e.id,
            "change_type": e.change_type,
            "object_name": e.object_name,
            "status": e.status,
            "submitted_by": e.submitted_by,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in recent
    ]

    # 热门表:下游可达表数量 Top5
    adj: dict = {}
    for e in db.query(LineageEdge).all():
        adj.setdefault(e.src_table_id, []).append(e.dst_table_id)
    tables = db.query(DataTable).all()
    hot = sorted(
        (HotTable(name=t.name, downstream=_downstream_count(adj, t.id)) for t in tables),
        key=lambda h: (-h.downstream, h.name),
    )[:5]
    hot_tables = [h for h in hot if h.downstream > 0] or hot

    return DashboardStats(
        table_count=table_count,
        report_count=report_count,
        system_count=system_count,
        edge_count=edge_count,
        pending_changes=pending_changes,
        pending_approvals=pending_approvals,
        layer_distribution=layer_distribution,
        recent_changes=recent_changes,
        hot_tables=hot_tables,
    )
