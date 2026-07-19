"""血缘解析引擎:基于 sqlglot(Spark 方言)的纯函数解析模块。

按架构契约第 3 节实现:
- 支持 CREATE TABLE(纯 DDL 与 CTAS)、CREATE VIEW、INSERT OVERWRITE/INTO、
  ALTER TABLE、裸 SELECT(需调用方提供 target_table);
- 源表提取处理 JOIN / 子查询 / UNION / CTE(排除 CTE 别名);
- 库表名小写规范化,缺库名归 default;
- 列级映射 best-effort,解析不出不报错,仅记 warnings。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import sqlglot
from sqlglot import exp

DEFAULT_DB = "default"
DIALECT = "spark"


# ---------------------------------------------------------------- 数据结构
@dataclass
class ColumnInfo:
    """一个表字段。"""

    name: str
    data_type: str = ""
    comment: Optional[str] = None
    ordinal: int = 0


@dataclass
class EdgeInfo:
    """一条血缘关系:target ← sources(列级映射 best-effort)。"""

    target: str
    sources: list = field(default_factory=list)
    column_mapping: list = field(default_factory=list)


@dataclass
class AlterOp:
    """ALTER TABLE 产生的字段操作(add / drop / change)。"""

    table: str
    op: str  # add / drop / change
    column: Optional[ColumnInfo] = None  # add/change 时的新字段
    old_name: Optional[str] = None  # drop/change 时的原字段名


@dataclass
class ParseResult:
    """parse_script 的统一返回(纯数据,不落库)。"""

    targets: list = field(default_factory=list)  # 目标表名列表(有序去重)
    sources: list = field(default_factory=list)  # 源表名列表(有序去重)
    edges: list = field(default_factory=list)  # EdgeInfo 列表
    columns_by_table: dict = field(default_factory=dict)  # 表名 -> [ColumnInfo](全量)
    alters: list = field(default_factory=list)  # AlterOp 列表(ALTER 且表中无全量定义时)
    warnings: list = field(default_factory=list)


# ---------------------------------------------------------------- 工具函数
def normalize_table_name(name: str) -> str:
    """库表名小写规范化;无库名归 default。"""
    name = (name or "").strip().strip("`").lower()
    if not name:
        return ""
    parts = [p for p in name.split(".") if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return f"{DEFAULT_DB}.{parts[0]}"
    # 有 catalog 时取最后两段 db.table
    return ".".join(parts[-2:])


def _table_name(tbl: exp.Table) -> str:
    """从 exp.Table 提取规范化全名。"""
    db = (tbl.db or "").lower()
    name = (tbl.name or "").lower()
    if not name:
        return ""
    full = f"{db}.{name}" if db else name
    return normalize_table_name(full)


def _ordered_add(lst: list, item: str) -> None:
    """有序去重追加。"""
    if item and item not in lst:
        lst.append(item)


def _column_def_to_info(cd: exp.ColumnDef, ordinal: int) -> ColumnInfo:
    """ColumnDef -> ColumnInfo(含 COMMENT 提取)。"""
    data_type = ""
    kind = cd.args.get("kind")
    if kind is not None:
        data_type = kind.sql(dialect=DIALECT).upper()
    comment = None
    for constraint in cd.args.get("constraints") or []:
        if isinstance(constraint, exp.ColumnConstraint) and isinstance(
            constraint.kind, exp.CommentColumnConstraint
        ):
            lit = constraint.kind.this
            if isinstance(lit, exp.Literal):
                comment = lit.this
    return ColumnInfo(
        name=(cd.name or "").lower(),
        data_type=data_type,
        comment=comment,
        ordinal=ordinal,
    )


# ---------------------------------------------------------------- 源表提取
def _cte_map(query: exp.Expression) -> dict:
    """查询中全部 CTE:别名(小写) -> CTE 的 Select 节点。"""
    out = {}
    for cte in query.find_all(exp.CTE):
        alias = (cte.alias_or_name or "").lower()
        if alias and isinstance(cte.this, exp.Select):
            out[alias] = cte.this
    return out


def _extract_sources(
    query: exp.Expression, ctes: dict, exclude_nodes: tuple = ()
) -> list:
    """遍历语句中的全部 exp.Table(FROM/JOIN/子查询/UNION/CTE 引用及其定义),
    排除 CTE 别名自身与 exclude_nodes(目标表节点,按节点身份排除以保留自循环边),
    返回有序去重的规范化表名列表。"""
    sources: list = []
    for tbl in query.find_all(exp.Table):
        if any(tbl is ex for ex in exclude_nodes):
            continue
        full = _table_name(tbl)
        if not full:
            continue
        # CTE 引用:无库名且名字是 CTE 别名 -> 不是真实物理表,排除
        if not tbl.db and (tbl.name or "").lower() in ctes:
            continue
        _ordered_add(sources, full)
    return sources


# ---------------------------------------------------------------- 列级映射
def _select_branches(node: exp.Expression) -> list:
    """展开查询顶层的 Select 分支(UNION/EXCEPT/INTERSECT 各支 + CTE 包裹),
    不深入 FROM 子查询内部(子查询在别名解析时递归处理)。"""
    branches: list = []

    def walk(n):
        if n is None or not isinstance(n, exp.Expression):
            return
        if isinstance(n, exp.Select):
            branches.append(n)
            return
        if isinstance(n, exp.SetOperation):  # UNION / EXCEPT / INTERSECT
            walk(n.this)
            walk(n.expression)
            return
        # With / Subquery / Paren 等:继续向内找主查询
        walk(n.this)

    walk(node)
    return branches


def _scope_alias_map(select: exp.Select, ctes: dict) -> dict:
    """一个 Select 作用域内的 别名(小写) -> 来源描述:
    {"kind": "table", "name": 全名} 或 {"kind": "query", "select": Select}(CTE/子查询)"""
    amap: dict = {}

    def register(tbl: exp.Table):
        alias_key = (tbl.alias_or_name or tbl.name or "").lower()
        if not alias_key:
            return
        name_key = (tbl.name or "").lower()
        if not tbl.db and name_key in ctes:
            amap[alias_key] = {"kind": "query", "select": ctes[name_key]}
            amap.setdefault(name_key, amap[alias_key])
        else:
            full = _table_name(tbl)
            if full:
                amap[alias_key] = {"kind": "table", "name": full}
                amap.setdefault(name_key, {"kind": "table", "name": full})

    from_ = select.args.get("from_")
    if from_ is not None:
        for tbl in from_.find_all(exp.Table):
            register(tbl)
        for sub in from_.find_all(exp.Subquery):
            key = (sub.alias_or_name or "").lower()
            if key and isinstance(sub.this, exp.Select):
                amap[key] = {"kind": "query", "select": sub.this}
    for join in select.args.get("joins") or []:
        for tbl in join.find_all(exp.Table):
            register(tbl)
        for sub in join.find_all(exp.Subquery):
            key = (sub.alias_or_name or "").lower()
            if key and isinstance(sub.this, exp.Select):
                amap[key] = {"kind": "query", "select": sub.this}
    return amap


def _resolve_column(qualifier: str, col_name: str, amap: dict, ctes: dict, depth: int):
    """把 (表/别名限定符, 列名) 解析为真实物理表来源列表;CTE/子查询递归追踪。"""
    entry = amap.get((qualifier or "").lower())
    if entry is None or depth < 0:
        return []
    if entry["kind"] == "table":
        return [{"table": entry["name"], "column": col_name.lower()}]
    # CTE / 子查询:在其投影中找同名列继续向内追踪
    inner: exp.Select = entry["select"]
    inner_map = _scope_alias_map(inner, ctes)
    for proj in inner.expressions:
        out_name = (proj.alias_or_name or proj.output_name or "").lower()
        if out_name != col_name.lower():
            continue
        found = []
        for col in proj.find_all(exp.Column):
            found.extend(_column_sources(col, inner_map, ctes, depth - 1))
        return found
    return []


def _column_sources(col: exp.Column, amap: dict, ctes: dict, depth: int):
    """单个 exp.Column -> 来源列表(限定符可定位源表;无限定符且作用域唯一表时归属之)。"""
    qualifier = (col.table or "").lower()
    col_name = (col.name or "").lower()
    if not col_name or col_name == "*":
        return []
    if qualifier:
        return _resolve_column(qualifier, col_name, amap, ctes, depth)
    # 无限定符:作用域内只有一个来源时归属之
    real = [v for v in amap.values() if v["kind"] == "table"]
    names = {v["name"] for v in real}
    if len(names) == 1:
        return [{"table": names.pop(), "column": col_name}]
    return []  # 无法定位,best-effort 跳过


def _column_mapping(query: exp.Expression, ctes: dict) -> list:
    """对 CTAS/INSERT 的 SELECT 投影做列级映射(best-effort):
    [{"target_col":..,"sources":[{"table":..,"column":..}]}]
    表达式/聚合无别名时以 expression 文本作为 target_col,sources 可为空数组。"""
    merged: dict = {}

    def merge_one(target_col: str, sources: list):
        item = merged.setdefault(target_col, {"target_col": target_col, "sources": []})
        seen = {(s["table"], s["column"]) for s in item["sources"]}
        for s in sources:
            key = (s["table"], s["column"])
            if key not in seen:
                seen.add(key)
                item["sources"].append(s)

    try:
        for branch in _select_branches(query):
            amap = _scope_alias_map(branch, ctes)
            for proj in branch.expressions:
                if isinstance(proj, exp.Star) or (
                    isinstance(proj, exp.Column) and (proj.name or "") == "*"
                ):
                    continue  # SELECT * 不产生映射
                name = (proj.alias_or_name or proj.output_name or "").lower()
                if not name:
                    name = proj.sql(dialect=DIALECT)  # 表达式/聚合:记 expression 文本
                sources: list = []
                for col in proj.find_all(exp.Column):
                    sources.extend(_column_sources(col, amap, ctes, depth=4))
                merge_one(name, sources)
    except Exception:
        pass  # best-effort:任何异常都不影响主流程
    return list(merged.values())


# ---------------------------------------------------------------- 语句处理
def _create_target(stmt: exp.Create):
    """CREATE 语句的目标表名(纯 DDL 时 this 为 Schema,CTAS/View 时为 Table)。"""
    node = stmt.this
    if isinstance(node, exp.Schema):
        node = node.this
    if isinstance(node, exp.Table):
        return _table_name(node)
    return ""


def _handle_create(stmt: exp.Create, result: ParseResult) -> None:
    kind = (stmt.args.get("kind") or "TABLE").upper()
    if kind not in ("TABLE", "VIEW"):
        result.warnings.append(f"暂不支持的 CREATE 类型 {kind},已跳过")
        return
    target = _create_target(stmt)
    if not target:
        result.warnings.append("CREATE 语句无法识别目标表,已跳过")
        return
    _ordered_add(result.targets, target)

    query = stmt.args.get("expression")
    if query is not None:
        # CTAS / CREATE VIEW AS SELECT:目标表 + 源表边
        # 注意:WITH 可能挂在 Create 节点上,故 CTE 与源表提取基于整条语句
        target_node = stmt.this.this if isinstance(stmt.this, exp.Schema) else stmt.this
        ctes = _cte_map(stmt)
        sources = _extract_sources(stmt, ctes, exclude_nodes=(target_node,))
        mapping = _column_mapping(query, ctes)
        for s in sources:
            _ordered_add(result.sources, s)
        if sources:
            result.edges.append(
                EdgeInfo(target=target, sources=sources, column_mapping=mapping)
            )
        else:
            result.warnings.append(f"{target}:未提取到源表,仅注册目标表")
        return

    # 纯 DDL:注册表 + 字段
    if isinstance(stmt.this, exp.Schema):
        cols = [
            _column_def_to_info(cd, i)
            for i, cd in enumerate(stmt.this.expressions)
            if isinstance(cd, exp.ColumnDef) and cd.name
        ]
        result.columns_by_table[target] = cols


def _handle_insert(stmt: exp.Insert, result: ParseResult) -> None:
    target = _table_name(stmt.this) if isinstance(stmt.this, exp.Table) else ""
    if not target:
        result.warnings.append("INSERT 语句无法识别目标表,已跳过")
        return
    _ordered_add(result.targets, target)
    query = stmt.expression
    if query is None or isinstance(query, exp.Values):
        # INSERT ... VALUES:无血缘边
        return
    # WITH 可能前置(挂在 Insert 节点),故 CTE 与源表提取基于整条语句
    ctes = _cte_map(stmt)
    sources = _extract_sources(stmt, ctes, exclude_nodes=(stmt.this,))
    mapping = _column_mapping(query, ctes)
    for s in sources:
        _ordered_add(result.sources, s)
    if sources:
        result.edges.append(EdgeInfo(target=target, sources=sources, column_mapping=mapping))
    else:
        result.warnings.append(f"{target}:INSERT 未提取到源表")


def _handle_alter(stmt: exp.Alter, result: ParseResult) -> None:
    table = _table_name(stmt.this) if isinstance(stmt.this, exp.Table) else ""
    if not table:
        result.warnings.append("ALTER 语句无法识别目标表,已跳过")
        return
    _ordered_add(result.targets, table)

    existing = result.columns_by_table.get(table)  # 同脚本内若已有 CREATE,则直接演化全量
    ops: list = []

    def record(op: AlterOp):
        if existing is not None:
            _apply_op_to_list(existing, op)
        else:
            ops.append(op)

    for action in stmt.args.get("actions") or []:
        if isinstance(action, exp.Schema):
            # ADD COLUMNS (...)
            base = len(existing) if existing is not None else 0
            for i, cd in enumerate(action.expressions):
                if isinstance(cd, exp.ColumnDef) and cd.name:
                    record(AlterOp(table=table, op="add", column=_column_def_to_info(cd, base + i)))
        elif isinstance(action, exp.ColumnDef):
            # ADD COLUMN ...
            base = len(existing) if existing is not None else 0
            record(AlterOp(table=table, op="add", column=_column_def_to_info(action, base)))
        elif isinstance(action, exp.AlterColumn):
            # CHANGE COLUMN old new type [COMMENT '...']
            old = (action.this.name if isinstance(action.this, exp.Identifier) else str(action.this or "")).lower()
            new_name = (action.args.get("rename_to").name if action.args.get("rename_to") else old).lower()
            dtype = action.args.get("dtype")
            comment_lit = action.args.get("comment")
            record(
                AlterOp(
                    table=table,
                    op="change",
                    old_name=old,
                    column=ColumnInfo(
                        name=new_name,
                        data_type=dtype.sql(dialect=DIALECT).upper() if dtype else "",
                        comment=comment_lit.this if isinstance(comment_lit, exp.Literal) else None,
                    ),
                )
            )
        elif isinstance(action, exp.Drop):
            # DROP COLUMNS (x, y)
            schema = action.this
            names = []
            if isinstance(schema, exp.Schema):
                names = [e.name.lower() for e in schema.expressions if e.name]
            elif isinstance(schema, exp.Identifier):
                names = [schema.name.lower()]
            for n in names:
                record(AlterOp(table=table, op="drop", old_name=n))

    result.alters.extend(ops)
    if existing is None and ops and table not in result.columns_by_table:
        # 占位:表明该表出现过 ALTER(便于上层识别)
        pass


def _apply_op_to_list(cols: list, op: AlterOp) -> None:
    """把 ALTER 操作应用到字段列表(脚本内 CREATE + ALTER 组合时演化全量)。"""
    if op.op == "add" and op.column is not None:
        if not any(c.name == op.column.name for c in cols):
            op.column.ordinal = len(cols)
            cols.append(op.column)
    elif op.op == "drop" and op.old_name:
        cols[:] = [c for c in cols if c.name != op.old_name]
    elif op.op == "change" and op.old_name:
        for i, c in enumerate(cols):
            if c.name == op.old_name:
                new = op.column or ColumnInfo(name=op.old_name)
                cols[i] = ColumnInfo(
                    name=new.name or c.name,
                    data_type=new.data_type or c.data_type,
                    comment=new.comment if new.comment is not None else c.comment,
                    ordinal=c.ordinal,
                )
                break


# DROP COLUMN 在 spark 方言下会退化为 Command,用正则兜底恢复
_DROP_COLUMN_RE = re.compile(
    r"ALTER\s+TABLE\s+([`\w.]+)\s+DROP\s+COLUMNS?\s*(?:\(([^)]*)\)|([`\w]+))",
    re.IGNORECASE,
)


def _handle_command(stmt: exp.Command, raw_sql: str, result: ParseResult) -> None:
    text = f"{stmt.this} {stmt.args.get('expression') or ''}".strip()
    m = _DROP_COLUMN_RE.search(text) or _DROP_COLUMN_RE.search(raw_sql)
    if m:
        table = normalize_table_name(m.group(1))
        names = [n.strip().strip("`").lower() for n in (m.group(2) or m.group(3) or "").split(",") if n.strip()]
        _ordered_add(result.targets, table)
        existing = result.columns_by_table.get(table)
        for n in names:
            op = AlterOp(table=table, op="drop", old_name=n)
            if existing is not None:
                _apply_op_to_list(existing, op)
            else:
                result.alters.append(op)
        return
    result.warnings.append(f"无法解析的语句,已跳过:{text[:80]}")


def _handle_select(stmt: exp.Select, result: ParseResult, target_table: Optional[str]) -> None:
    ctes = _cte_map(stmt)
    sources = _extract_sources(stmt, ctes)
    for s in sources:
        _ordered_add(result.sources, s)
    if not target_table:
        result.warnings.append(
            "裸 SELECT 语句未提供 target_table,已跳过血缘生成"
        )
        return
    target = normalize_table_name(target_table)
    _ordered_add(result.targets, target)
    if sources:
        mapping = _column_mapping(stmt, ctes)
        result.edges.append(EdgeInfo(target=target, sources=sources, column_mapping=mapping))


# ---------------------------------------------------------------- 主入口
def parse_script(sql_text: str, target_table: Optional[str] = None) -> ParseResult:
    """解析一段(可能多语句的)SQL 脚本,返回 ParseResult。

    纯函数:不做任何数据库读写;单条语句失败记入 warnings 不中断。
    """
    result = ParseResult()
    sql_text = sql_text or ""
    if not sql_text.strip():
        result.warnings.append("空 SQL 脚本")
        return result

    try:
        statements = sqlglot.parse(sql_text, read=DIALECT)
    except Exception as exc:  # 整体解析失败(如词法错误)
        result.warnings.append(f"SQL 解析失败:{exc}")
        return result

    for stmt in statements:
        if stmt is None:
            continue
        try:
            if isinstance(stmt, exp.Create):
                _handle_create(stmt, result)
            elif isinstance(stmt, exp.Insert):
                _handle_insert(stmt, result)
            elif isinstance(stmt, exp.Alter):
                _handle_alter(stmt, result)
            elif isinstance(stmt, exp.Command):
                _handle_command(stmt, sql_text, result)
            elif isinstance(stmt, (exp.Select, exp.Union, exp.Except, exp.Intersect)):
                _handle_select(stmt, result, target_table)
            elif isinstance(stmt, (exp.Use, exp.Set, exp.AddFile, exp.Pragma)):
                continue  # 会话级语句,直接忽略
            else:
                result.warnings.append(
                    f"不支持的语句类型 {type(stmt).__name__},已跳过"
                )
        except Exception as exc:  # 单条失败不中断
            result.warnings.append(f"语句处理失败({type(stmt).__name__}):{exc}")

    return result
