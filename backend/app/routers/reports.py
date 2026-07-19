"""报表管理路由。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import DataTable, Report, System
from backend.app.schemas import ReportIn, ReportOut

router = APIRouter(prefix="/reports", tags=["reports"])


def _to_out(rep: Report) -> ReportOut:
    return ReportOut(
        id=rep.id,
        name=rep.name,
        table_id=rep.table_id,
        table_name=rep.table.name if rep.table else None,
        target_system_id=rep.target_system_id,
        target_system_name=rep.target_system.name if rep.target_system else None,
        owner=rep.owner or "",
        owner_contact=rep.owner_contact or "",
        schedule=rep.schedule or "",
        description=rep.description or "",
    )


def _validate_refs(db: Session, payload: ReportIn):
    if db.get(DataTable, payload.table_id) is None:
        raise HTTPException(400, "table_id 指向的表不存在")
    if db.get(System, payload.target_system_id) is None:
        raise HTTPException(400, "target_system_id 指向的系统不存在")


@router.get("", response_model=list[ReportOut])
def list_reports(db: Session = Depends(get_db)):
    return [_to_out(r) for r in db.query(Report).order_by(Report.id).all()]


@router.post("", response_model=ReportOut)
def create_report(payload: ReportIn, db: Session = Depends(get_db)):
    _validate_refs(db, payload)
    obj = Report(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.put("/{report_id}", response_model=ReportOut)
def update_report(report_id: int, payload: ReportIn, db: Session = Depends(get_db)):
    obj = db.get(Report, report_id)
    if obj is None:
        raise HTTPException(404, "报表不存在")
    _validate_refs(db, payload)
    for k, v in payload.model_dump().items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return _to_out(obj)


@router.delete("/{report_id}", status_code=204)
def delete_report(report_id: int, db: Session = Depends(get_db)):
    obj = db.get(Report, report_id)
    if obj is None:
        raise HTTPException(404, "报表不存在")
    db.delete(obj)
    db.commit()
