"""解析引擎单元测试(纯函数,不碰数据库)。"""
from backend.app.lineage.parser import parse_script


def test_create_table_ddl_columns():
    """纯 DDL:注册表 + 字段(含 COMMENT),无血缘边。"""
    r = parse_script(
        """CREATE TABLE IF NOT EXISTS ods.ods_trade_order (
          order_id BIGINT COMMENT '订单ID',
          total_amount DECIMAL(12,2) COMMENT '订单总金额',
          order_status STRING
        ) COMMENT '订单表'"""
    )
    assert r.targets == ["ods.ods_trade_order"]
    assert r.sources == [] and r.edges == []
    cols = r.columns_by_table["ods.ods_trade_order"]
    assert [c.name for c in cols] == ["order_id", "total_amount", "order_status"]
    assert cols[0].comment == "订单ID"
    assert cols[1].data_type.replace(" ", "") == "DECIMAL(12,2)"
    assert [c.ordinal for c in cols] == [0, 1, 2]
    assert r.warnings == []


def test_ctas_lineage():
    """CTAS:目标表 + 多源表边 + 列级映射。"""
    r = parse_script(
        "CREATE TABLE ads.ads_x AS "
        "SELECT a.id AS aid, b.name, COUNT(*) AS cnt "
        "FROM db1.a a JOIN db2.b b ON a.id = b.id GROUP BY a.id, b.name"
    )
    assert r.targets == ["ads.ads_x"]
    assert r.sources == ["db1.a", "db2.b"]
    assert len(r.edges) == 1
    edge = r.edges[0]
    assert edge.target == "ads.ads_x" and edge.sources == ["db1.a", "db2.b"]
    mapping = {m["target_col"]: m["sources"] for m in edge.column_mapping}
    assert mapping["aid"] == [{"table": "db1.a", "column": "id"}]
    assert mapping["name"] == [{"table": "db2.b", "column": "name"}]
    assert "cnt" in mapping  # 聚合列:sources 可为空


def test_create_view_lineage():
    r = parse_script("CREATE VIEW dws.v_x AS SELECT id FROM dwd.t1")
    assert r.targets == ["dws.v_x"]
    assert r.sources == ["dwd.t1"]
    assert r.edges[0].target == "dws.v_x"


def test_insert_overwrite_lineage():
    """INSERT OVERWRITE:目标表 + 源表边。"""
    r = parse_script(
        "INSERT OVERWRITE TABLE dwd.dwd_t PARTITION(dt='2024-01-01') "
        "SELECT o.id, u.name FROM ods.o o JOIN ods.u u ON o.uid = u.id"
    )
    assert r.targets == ["dwd.dwd_t"]
    assert sorted(r.sources) == ["ods.o", "ods.u"]
    assert r.edges[0].target == "dwd.dwd_t"


def test_insert_into_lineage():
    r = parse_script("INSERT INTO TABLE dwd.t SELECT id FROM ods.s")
    assert r.targets == ["dwd.t"] and r.sources == ["ods.s"]


def test_multi_statement_script():
    """多语句脚本:DDL + INSERT 混合,目标/源聚合。"""
    r = parse_script(
        """CREATE TABLE ods.a (id INT, v STRING);
           CREATE TABLE ods.b (id INT, w STRING);
           INSERT OVERWRITE TABLE dwd.c SELECT a.id, b.w FROM ods.a a JOIN ods.b b ON a.id=b.id;"""
    )
    assert r.targets == ["ods.a", "ods.b", "dwd.c"]
    assert sorted(r.sources) == ["ods.a", "ods.b"]
    assert set(r.columns_by_table.keys()) == {"ods.a", "ods.b"}
    assert len(r.edges) == 1


def test_cte_alias_excluded():
    """CTE 别名必须排除,但 CTE 定义内的真实表要计入。"""
    r = parse_script(
        """WITH tmp AS (SELECT id, val FROM ods.real_a),
              tmp2 AS (SELECT id FROM tmp JOIN dim.real_b b ON tmp.id = b.id)
           INSERT OVERWRITE TABLE dwd.t SELECT * FROM tmp2"""
    )
    assert r.targets == ["dwd.t"]
    assert "default.tmp" not in r.sources and "default.tmp2" not in r.sources
    assert sorted(r.sources) == ["dim.real_b", "ods.real_a"]


def test_union_and_subquery_sources():
    """UNION 各支与 FROM 子查询的源表都要提取。"""
    r = parse_script(
        """INSERT OVERWRITE TABLE dwd.t
           SELECT x.id FROM (SELECT id FROM ods.a WHERE f = 1) x
           UNION ALL SELECT id FROM ods.b
           UNION ALL SELECT id FROM (SELECT id FROM ods.c) y"""
    )
    assert sorted(r.sources) == ["ods.a", "ods.b", "ods.c"]


def test_alter_table_add_change_drop():
    """ALTER:ADD/CHANGE/DROP 操作;同脚本 CREATE 时演化为全量。"""
    r = parse_script(
        """CREATE TABLE ods.t1 (a INT, b STRING COMMENT 'b列');
           ALTER TABLE ods.t1 ADD COLUMNS (c DECIMAL(10,2) COMMENT '新列');
           ALTER TABLE ods.t1 CHANGE COLUMN a a2 BIGINT;
           ALTER TABLE ods.t1 DROP COLUMN b;"""
    )
    cols = r.columns_by_table["ods.t1"]
    assert [(c.name, c.data_type) for c in cols] == [
        ("a2", "BIGINT"),
        ("c", "DECIMAL(10, 2)"),
    ]


def test_alter_only_script_produces_ops():
    """纯 ALTER 脚本:产生 add/drop 操作,交给上层增量应用。"""
    r = parse_script(
        "ALTER TABLE ods.x ADD COLUMN n1 INT; "
        "ALTER TABLE ods.x DROP COLUMNS (old1, old2)"
    )
    ops = [(a.op, a.old_name, a.column.name if a.column else None) for a in r.alters]
    assert ("add", None, "n1") in ops
    assert ("drop", "old1", None) in ops
    assert ("drop", "old2", None) in ops


def test_bare_select_with_target_table():
    """裸 SELECT + target_table:边指向目标表。"""
    r = parse_script(
        "SELECT a.id, b.v FROM dwd.a a JOIN dwd.b b ON a.id = b.id",
        target_table="ADS.T_OUT",
    )
    assert r.targets == ["ads.t_out"]  # 小写规范化
    assert sorted(r.sources) == ["dwd.a", "dwd.b"]
    assert r.edges[0].target == "ads.t_out"


def test_bare_select_without_target_warns():
    """裸 SELECT 无 target_table:记 warning,不产生边。"""
    r = parse_script("SELECT id FROM dwd.a")
    assert r.edges == [] and r.targets == []
    assert any("target_table" in w for w in r.warnings)
    assert r.sources == ["dwd.a"]  # 源表仍提取,便于预览


def test_default_db_and_lowercase():
    """缺库名归 default;库表名小写规范化。"""
    r = parse_script("INSERT INTO MyTable SELECT id FROM SrcDB.SrcTable")
    assert r.targets == ["default.mytable"]
    assert r.sources == ["srcdb.srctable"]


def test_bad_statement_not_interrupt():
    """单条失败记 warnings 不中断后续语句。"""
    r = parse_script("CREATE TABL broken ((; CREATE TABLE ok.t (a INT)")
    assert "ok.t" in r.targets
    assert len(r.warnings) == 1


def test_column_mapping_unqualified_single_table():
    """单源查询的无限定符列归属唯一源表。"""
    r = parse_script("CREATE TABLE x.t AS SELECT id, val + 1 AS v2 FROM ods.only")
    mapping = {m["target_col"]: m["sources"] for m in r.edges[0].column_mapping}
    assert mapping["id"] == [{"table": "ods.only", "column": "id"}]
    assert mapping["v2"] == [{"table": "ods.only", "column": "val"}]
