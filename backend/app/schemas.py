"""Pydantic 模型:严格对应架构契约第 2 节的 API 字段。"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ---------------------------------------------------------------- 系统
class SystemIn(BaseModel):
    name: str
    kind: str = "both"
    owner: str = ""
    contact: str = ""
    description: str = ""


class SystemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    owner: str
    contact: str
    description: str


# ---------------------------------------------------------------- 表
class TableUpdate(BaseModel):
    source_system_id: Optional[int] = None
    owner: Optional[str] = None
    description: Optional[str] = None


class ColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    data_type: str
    comment: Optional[str] = None
    ordinal: int


class TableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    layer: str
    source_system_id: Optional[int] = None
    source_system_name: Optional[str] = None
    owner: str
    description: str
    column_count: int = 0
    created_at: datetime
    updated_at: datetime


class TableDetail(TableOut):
    columns: list[ColumnOut] = []


# ---------------------------------------------------------------- 脚本
class ScriptListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sql_type: str
    sql_text: str = ""  # 列表页截断返回
    target_table: Optional[str] = None
    version: int
    created_at: datetime
    updated_at: datetime


class ScriptDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    sql_type: str
    sql_text: str
    target_table: Optional[str] = None
    version: int
    created_at: datetime
    updated_at: datetime


class ParseRequest(BaseModel):
    name: str
    sql_text: str
    target_table: Optional[str] = None


class ParseResponse(BaseModel):
    script_id: int
    target_tables: list[str]
    source_tables: list[str]
    tables_created: list[str]
    edges_created: int
    warnings: list[str]


class ScriptUpdateRequest(BaseModel):
    sql_text: str


class ScriptUpdateResponse(ParseResponse):
    change_event_id: Optional[int] = None


# ---------------------------------------------------------------- 批量导入
class BatchImportRequest(BaseModel):
    """批量导入 SQL 目录请求。"""

    dir_path: str
    recursive: bool = True  # 是否递归子目录


class BatchImportResultItem(BaseModel):
    """单文件导入结果:status = ok(无警告)/ warning(有警告)/ error(异常或解析全废)。"""

    file: str  # 相对目录的文件路径
    script_id: Optional[int] = None  # 成功落库的脚本 ID(读取失败时为 None)
    status: str
    target_tables: list[str] = []
    source_tables: list[str] = []
    edges_created: int = 0
    warnings: list[str] = []
    error: Optional[str] = None  # 仅 status=error 时有值


class BatchImportSummary(BaseModel):
    total: int
    ok: int
    warning: int
    error: int
    edges_created: int


class BatchImportResponse(BaseModel):
    summary: BatchImportSummary
    results: list[BatchImportResultItem]


# ---------------------------------------------------------------- 鉴权(演示级)
class AuthUser(BaseModel):
    """预设用户(姓名 + 角色,供登录页展示,不含密码)。"""

    name: str
    role: str


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: AuthUser


# ---------------------------------------------------------------- 报表
class ReportIn(BaseModel):
    name: str
    table_id: int
    target_system_id: int
    owner: str = ""
    owner_contact: str = ""
    schedule: str = ""
    description: str = ""


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    table_id: int
    table_name: Optional[str] = None
    target_system_id: int
    target_system_name: Optional[str] = None
    owner: str
    owner_contact: str
    schedule: str
    description: str


# ---------------------------------------------------------------- 血缘图
class LineageNode(BaseModel):
    id: int
    name: str
    layer: str
    source_system: Optional[str] = None
    owner: str
    is_report_source: bool
    focus: Optional[bool] = None
    distance: Optional[int] = None


class LineageEdgeOut(BaseModel):
    id: int
    source: int
    target: int
    script_name: Optional[str] = None


class LineageGraph(BaseModel):
    nodes: list[LineageNode]
    edges: list[LineageEdgeOut]


# ---------------------------------------------------------------- 变更与审批
class DdlChangeRequest(BaseModel):
    table_id: int
    new_ddl: str
    submitted_by: str = ""


class SqlChangeRequest(BaseModel):
    script_id: int
    new_sql: str
    submitted_by: str = ""


class CreateTableChangeRequest(BaseModel):
    new_ddl: str
    submitted_by: str = ""


class DropTableChangeRequest(BaseModel):
    table_id: int
    submitted_by: str = ""


class ChangeEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    change_type: str
    object_name: str
    old_text: str
    new_text: str
    diff_summary: str
    status: str
    submitted_by: str
    created_at: datetime
    resolved_at: Optional[datetime] = None


class ChangeListItem(ChangeEventOut):
    """变更事件列表项:事件字段 + 影响/任务计数。"""

    impact_count: int = 0
    pending_tasks: int = 0
    approved_tasks: int = 0


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    change_event_id: int
    approver_name: str
    approver_role: str
    target_type: str
    target_id: int
    target_name: str
    status: str
    comment: Optional[str] = None
    decided_at: Optional[datetime] = None


class ChangeDetail(BaseModel):
    event: ChangeEventOut
    diff: dict
    impacted_reports: list[dict]
    impacted_systems: list[dict]
    impacted_tables: list[dict]
    approvals: list[ApprovalOut]


class ApprovalListItem(ApprovalOut):
    """审批收件箱列表项:任务字段 + 事件摘要。"""

    change_event: dict


class DecisionRequest(BaseModel):
    decision: str  # approved / rejected
    comment: Optional[str] = None


# ---------------------------------------------------------------- 仪表盘
class LayerCount(BaseModel):
    layer: str
    count: int


class HotTable(BaseModel):
    name: str
    downstream: int


class DashboardStats(BaseModel):
    table_count: int
    report_count: int
    system_count: int
    edge_count: int
    pending_changes: int
    pending_approvals: int
    layer_distribution: list[LayerCount]
    recent_changes: list[dict]
    hot_tables: list[HotTable]
