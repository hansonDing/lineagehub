"""ORM 模型:严格对应架构契约第 1 节。"""
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from backend.app.database import Base


def utcnow() -> datetime:
    """UTC 当前时间(naive,避免 utcnow() 弃用警告;SQLite 存 naive)。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class System(Base):
    """业务系统(既可作数据来源,也可作报表目标)。"""

    __tablename__ = "systems"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    kind = Column(String, nullable=False, default="both")  # source / target / both
    owner = Column(String, default="")
    contact = Column(String, default="")
    description = Column(String, default="")


class DataTable(Base):
    """数仓表。"""

    __tablename__ = "tables"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)  # 小写规范化,含库名前缀
    layer = Column(String, default="other")  # ods/dwd/dws/ads/dim/other
    source_system_id = Column(Integer, ForeignKey("systems.id"), nullable=True)
    owner = Column(String, default="")
    description = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    source_system = relationship("System")
    columns = relationship(
        "TableColumn", back_populates="table", cascade="all, delete-orphan",
        order_by="TableColumn.ordinal",
    )


class TableColumn(Base):
    """表字段(来自 DDL)。"""

    __tablename__ = "table_columns"

    id = Column(Integer, primary_key=True)
    table_id = Column(Integer, ForeignKey("tables.id"), nullable=False)
    name = Column(String, nullable=False)
    data_type = Column(String, default="")
    comment = Column(String, nullable=True)
    ordinal = Column(Integer, default=0)

    table = relationship("DataTable", back_populates="columns")


class SqlScript(Base):
    """SQL 脚本。"""

    __tablename__ = "sql_scripts"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    sql_type = Column(String, default="etl")  # ddl / etl(解析时自动判别)
    sql_text = Column(Text, nullable=False)
    target_table = Column(String, nullable=True)  # 裸 SELECT 时用户指定的目标表
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class LineageEdge(Base):
    """血缘边(表级),唯一约束 (src, dst, script) 保证幂等。"""

    __tablename__ = "lineage_edges"
    __table_args__ = (
        UniqueConstraint(
            "src_table_id", "dst_table_id", "script_id", name="uq_edge_src_dst_script"
        ),
    )

    id = Column(Integer, primary_key=True)
    src_table_id = Column(Integer, ForeignKey("tables.id"), nullable=False)
    dst_table_id = Column(Integer, ForeignKey("tables.id"), nullable=False)
    script_id = Column(Integer, ForeignKey("sql_scripts.id"), nullable=True)
    column_mapping = Column(Text, default="[]")  # JSON:列级映射 best-effort
    created_at = Column(DateTime, default=utcnow)

    src_table = relationship("DataTable", foreign_keys=[src_table_id])
    dst_table = relationship("DataTable", foreign_keys=[dst_table_id])
    script = relationship("SqlScript")


class Report(Base):
    """报表。"""

    __tablename__ = "reports"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    table_id = Column(Integer, ForeignKey("tables.id"), nullable=False)
    target_system_id = Column(Integer, ForeignKey("systems.id"), nullable=False)
    owner = Column(String, default="")
    owner_contact = Column(String, default="")
    schedule = Column(String, default="")
    description = Column(String, default="")

    table = relationship("DataTable")
    target_system = relationship("System")


class ChangeEvent(Base):
    """变更事件。"""

    __tablename__ = "change_events"

    id = Column(Integer, primary_key=True)
    change_type = Column(String, nullable=False)  # ddl_change / sql_change
    object_name = Column(String, nullable=False)  # 被改的表名或脚本名
    old_text = Column(Text, default="")
    new_text = Column(Text, default="")
    diff_summary = Column(Text, default="{}")  # JSON:列差异或血缘边差异
    status = Column(String, default="pending")  # pending / approved / rejected
    submitted_by = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)
    resolved_at = Column(DateTime, nullable=True)

    approvals = relationship(
        "ApprovalTask", back_populates="change_event", cascade="all, delete-orphan"
    )


class IntegrationSetting(Base):
    """集成设置键值表(key: 'ado' / 'smtp' / 'emails',value 为 JSON 文本)。"""

    __tablename__ = "integration_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, default="{}")


class ApprovalTask(Base):
    """审批任务(每个受影响负责人一条)。"""

    __tablename__ = "approval_tasks"

    id = Column(Integer, primary_key=True)
    change_event_id = Column(Integer, ForeignKey("change_events.id"), nullable=False)
    approver_name = Column(String, default="")
    approver_role = Column(String, default="")  # report_owner / system_owner / table_owner
    target_type = Column(String, default="")  # report / system / table
    target_id = Column(Integer, default=0)
    target_name = Column(String, default="")  # 冗余名称,便于展示
    status = Column(String, default="pending")  # pending / approved / rejected
    comment = Column(String, nullable=True)
    decided_at = Column(DateTime, nullable=True)

    change_event = relationship("ChangeEvent", back_populates="approvals")
