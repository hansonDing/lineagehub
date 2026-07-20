"""批量导入 SQL 目录测试:汇总计数、血缘落库、重复导入幂等、目录校验、warning/error 状态。

注意:本模块与 test_api_smoke 共享同一个临时库(conftest 的 LINEAGE_DB_PATH),
故这里一律使用独立的 batch_* 表名,避免污染种子数据的统计口径。
"""
import pytest
from fastapi.testclient import TestClient

# 合法 DDL:注册源表 ods.batch_src_order
DDL_SQL = """CREATE TABLE IF NOT EXISTS ods.batch_src_order (
  order_id BIGINT COMMENT '订单ID',
  amount DECIMAL(12,2) COMMENT '订单金额'
) COMMENT '批量导入测试源表'"""

# 合法 CTAS:产生血缘边 ods.batch_src_order -> dwd.batch_tgt_order
CTAS_SQL = """CREATE TABLE dwd.batch_tgt_order AS
SELECT order_id, amount FROM ods.batch_src_order"""

# 垃圾内容:整体解析失败,什么都不产出
GARBAGE_SQL = "这不是 SQL,完全无法解析 !!! @@@"

# 裸 SELECT:能提取来源表但没有目标 -> 有 warnings -> warning 状态
BARE_SELECT_SQL = "SELECT order_id FROM ods.batch_src_order"


@pytest.fixture(scope="module")
def client():
    """模块级 TestClient:启动时自动建表 + 灌入种子数据(临时库)。"""
    from backend.app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def sql_dir(tmp_path):
    """构造 3 个文件的导入目录:合法 DDL、子目录中的合法 CTAS、垃圾内容。"""
    (tmp_path / "ddl_ods_batch_src.sql").write_text(DDL_SQL, encoding="utf-8")
    sub = tmp_path / "dwd"
    sub.mkdir()
    (sub / "etl_dwd_batch_tgt.sql").write_text(CTAS_SQL, encoding="utf-8")
    (tmp_path / "garbage.sql").write_text(GARBAGE_SQL, encoding="utf-8")
    return tmp_path


def _import(client, dir_path, recursive=True):
    return client.post(
        "/api/scripts/batch-import", json={"dir_path": str(dir_path), "recursive": recursive}
    )


def _table_id(client, name):
    for t in client.get("/api/tables").json():
        if t["name"] == name:
            return t["id"]
    raise AssertionError(f"表 {name} 不存在")


# ---------------------------------------------------------------- 计数与血缘落库
def test_batch_import_summary_and_results(client, sql_dir):
    r = _import(client, sql_dir)
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"total": 3, "ok": 2, "warning": 0, "error": 1, "edges_created": 1}

    results = {item["file"]: item for item in body["results"]}
    # 按相对路径排序:ddl_ods_batch_src.sql / dwd/etl_dwd_batch_tgt.sql / garbage.sql
    assert [item["file"] for item in body["results"]] == sorted(results.keys())

    ddl = results["ddl_ods_batch_src.sql"]
    assert ddl["status"] == "ok"
    assert ddl["script_id"] is not None
    assert ddl["target_tables"] == ["ods.batch_src_order"]
    assert ddl["warnings"] == [] and ddl["error"] is None

    ctas = results["dwd/etl_dwd_batch_tgt.sql"]
    assert ctas["status"] == "ok"
    assert ctas["target_tables"] == ["dwd.batch_tgt_order"]
    assert ctas["source_tables"] == ["ods.batch_src_order"]
    assert ctas["edges_created"] == 1

    garbage = results["garbage.sql"]
    assert garbage["status"] == "error"
    assert garbage["script_id"] is None
    assert garbage["error"]  # 有错误信息
    assert garbage["warnings"]  # 解析失败警告也带出

    # 脚本名 = 相对路径去 .sql 后缀(子目录带 /)
    names = {s["name"] for s in client.get("/api/scripts").json()}
    assert "ddl_ods_batch_src" in names
    assert "dwd/etl_dwd_batch_tgt" in names

    # 血缘边真实落库:ods.batch_src_order -> dwd.batch_tgt_order
    src_id = _table_id(client, "ods.batch_src_order")
    dst_id = _table_id(client, "dwd.batch_tgt_order")
    g = client.get("/api/lineage/overview").json()
    assert any(
        e["source"] == src_id and e["target"] == dst_id and e["script_name"] == "dwd/etl_dwd_batch_tgt"
        for e in g["edges"]
    )


# ---------------------------------------------------------------- 重复导入幂等
def test_batch_import_idempotent_reimport(client, sql_dir):
    r = _import(client, sql_dir)
    assert r.status_code == 200
    body = r.json()
    # 同名脚本按更新处理:不再新增血缘边
    assert body["summary"]["total"] == 3
    assert body["summary"]["edges_created"] == 0
    assert all(item["edges_created"] == 0 for item in body["results"])

    # 版本 +1(首次导入 version=1,重复导入 version=2)
    scripts = {s["name"]: s for s in client.get("/api/scripts").json()}
    assert scripts["ddl_ods_batch_src"]["version"] == 2
    assert scripts["dwd/etl_dwd_batch_tgt"]["version"] == 2

    # 血缘边不重复:该脚本仍只有 1 条边
    g = client.get("/api/lineage/overview").json()
    edges = [e for e in g["edges"] if e["script_name"] == "dwd/etl_dwd_batch_tgt"]
    assert len(edges) == 1


# ---------------------------------------------------------------- recursive=False 不递归子目录
def test_batch_import_non_recursive(client, sql_dir):
    r = _import(client, sql_dir, recursive=False)
    assert r.status_code == 200
    body = r.json()
    # 只有顶层 2 个 .sql(子目录 dwd/ 被跳过)
    assert body["summary"]["total"] == 2
    assert {item["file"] for item in body["results"]} == {
        "ddl_ods_batch_src.sql",
        "garbage.sql",
    }


# ---------------------------------------------------------------- warning 状态
def test_batch_import_warning_status(client, tmp_path):
    (tmp_path / "bare_select.sql").write_text(BARE_SELECT_SQL, encoding="utf-8")
    r = _import(client, tmp_path)
    assert r.status_code == 200
    body = r.json()
    assert body["summary"] == {"total": 1, "ok": 0, "warning": 1, "error": 0, "edges_created": 0}
    item = body["results"][0]
    assert item["status"] == "warning"
    assert item["source_tables"] == ["ods.batch_src_order"]
    assert any("target_table" in w for w in item["warnings"])


# ---------------------------------------------------------------- 目录校验
def test_batch_import_dir_not_found(client, tmp_path):
    r = _import(client, tmp_path / "不存在的目录")
    assert r.status_code == 404


def test_batch_import_path_is_file(client, sql_dir):
    r = _import(client, sql_dir / "garbage.sql")  # 指向文件而不是目录
    assert r.status_code == 404


def test_batch_import_empty_dir(client, tmp_path):
    r = _import(client, tmp_path)
    assert r.status_code == 200
    assert r.json()["summary"] == {"total": 0, "ok": 0, "warning": 0, "error": 0, "edges_created": 0}
    assert r.json()["results"] == []
