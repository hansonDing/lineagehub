"""数仓表路由。"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import DataTable, TableColumn
from backend.app.schemas import ColumnOut, TableDetail, TableOut, TableUpdate

router = APIRouter(prefix="/tables", tags=["tables"])


def _to_out(db: Session, table: DataTable) -> TableOut:
    """ORM -> 列表输出(补 source_system_name / column_count)。"""
    out = TableOut(
        id=table.id,
        name=table.name,
        layer=table.layer,
        source_system_id=table.source_system_id,
        source_system_name=table.source_system.name if table.source_system else None,
        owner=table.owner or "",
        description=table.description or "",
        column_count=len(table.columns),
        created_at=table.created_at,
        updated_at=table.updated_at,
    )
    return out


@router.get("", response_model=list[TableOut])
def list_tables(
    keyword: Optional[str] = None,
    layer: Optional[str] = None,
    source_system_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(DataTable)
    if keyword:
        q = q.filter(DataTable.name.contains(keyword.lower()))
    if layer:
        q = q.filter(DataTable.layer == layer)
    if source_system_id is not None:
        q = q.filter(DataTable.source_system_id == source_system_id)
    return [_to_out(db, t) for t in q.order_by(DataTable.name).all()]


@router.get("/{table_id}", response_model=TableDetail)
def get_table(table_id: int, db: Session = Depends(get_db)):
    table = db.get(DataTable, table_id)
    if table is None:
        raise HTTPException(404, "表不存在")
    return TableDetail(
        **_to_out(db, table).model_dump(),
        columns=[ColumnOut.model_validate(c) for c in table.columns],
    )


@router.put("/{table_id}", response_model=TableOut)
def update_table(table_id: int, payload: TableUpdate, db: Session = Depends(get_db)):
    table = db.get(DataTable, table_id)
    if table is None:
        raise HTTPException(404, "表不存在")
    data = payload.model_dump(exclude_unset=True)
    if "source_system_id" in data and data["source_system_id"] is not None:
        from backend.app.models import System

        if db.get(System, data["source_system_id"]) is None:
            raise HTTPException(400, "source_system_id 指向的系统不存在")
    for k, v in data.items():
        setattr(table, k, v)
    db.commit()
    db.refresh(table)
    return _to_out(db, table)
