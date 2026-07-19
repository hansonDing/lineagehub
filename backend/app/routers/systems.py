"""系统管理路由。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import DataTable, Report, System
from backend.app.schemas import SystemIn, SystemOut

router = APIRouter(prefix="/systems", tags=["systems"])


@router.get("", response_model=list[SystemOut])
def list_systems(db: Session = Depends(get_db)):
    return db.query(System).order_by(System.id).all()


@router.post("", response_model=SystemOut)
def create_system(payload: SystemIn, db: Session = Depends(get_db)):
    if db.query(System).filter(System.name == payload.name).first():
        raise HTTPException(409, f"系统 {payload.name} 已存在")
    obj = System(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{system_id}", response_model=SystemOut)
def update_system(system_id: int, payload: SystemIn, db: Session = Depends(get_db)):
    obj = db.get(System, system_id)
    if obj is None:
        raise HTTPException(404, "系统不存在")
    dup = db.query(System).filter(System.name == payload.name, System.id != system_id).first()
    if dup:
        raise HTTPException(409, f"系统 {payload.name} 已存在")
    for k, v in payload.model_dump().items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{system_id}", status_code=204)
def delete_system(system_id: int, db: Session = Depends(get_db)):
    obj = db.get(System, system_id)
    if obj is None:
        raise HTTPException(404, "系统不存在")
    # 被表或报表引用时禁止删除
    if db.query(DataTable).filter(DataTable.source_system_id == system_id).first():
        raise HTTPException(409, "系统被数仓表引用,无法删除")
    if db.query(Report).filter(Report.target_system_id == system_id).first():
        raise HTTPException(409, "系统被报表引用,无法删除")
    db.delete(obj)
    db.commit()
