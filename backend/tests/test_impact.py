"""影响分析单元测试:有向 BFS、报表/系统去重、环安全。"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.lineage.impact import downstream_impact
from backend.app.models import DataTable, LineageEdge, Report, System


@pytest.fixture()
def session():
    """独立内存库,构造 A->B->C、A->D 链与环 E->F->E。"""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()

    tables = {}
    for name in ["ods.a", "dwd.b", "dws.c", "ads.d", "x.e", "x.f", "x.g"]:
        t = DataTable(name=name, layer=name.split(".")[0], owner=f"owner_{name}")
        db.add(t)
        tables[name] = t
    db.flush()

    def edge(src, dst):
        db.add(LineageEdge(src_table_id=tables[src].id, dst_table_id=tables[dst].id))

    edge("ods.a", "dwd.b")
    edge("dwd.b", "dws.c")
    edge("ods.a", "ads.d")
    edge("x.e", "x.f")
    edge("x.f", "x.e")  # 环
    db.flush()

    bi = System(name="BI", kind="target", owner="周八")
    fin = System(name="财务", kind="target", owner="吴九")
    db.add_all([bi, fin])
    db.flush()
    db.add(Report(name="报表C", table_id=tables["dws.c"].id, target_system_id=bi.id, owner="张三"))
    db.add(Report(name="报表C2", table_id=tables["dws.c"].id, target_system_id=bi.id, owner="李四"))
    db.add(Report(name="报表D", table_id=tables["ads.d"].id, target_system_id=fin.id, owner="王五"))
    db.add(Report(name="报表A", table_id=tables["ods.a"].id, target_system_id=fin.id, owner="赵六"))
    db.commit()
    yield db, tables
    db.close()


def test_bfs_collects_all_downstream(session):
    """BFS 收集全部下游表(不含起点)。"""
    db, tables = session
    impact = downstream_impact(db, [tables["ods.a"].id])
    names = {t.name for t in impact["tables"]}
    assert names == {"dwd.b", "dws.c", "ads.d"}


def test_reports_and_systems_dedup(session):
    """关联报表去重;目标系统去重;含建在变更对象本身上的报表。"""
    db, tables = session
    impact = downstream_impact(db, [tables["ods.a"].id])
    report_names = {r.name for r in impact["reports"]}
    assert report_names == {"报表C", "报表C2", "报表D", "报表A"}
    system_names = {s.name for s in impact["systems"]}
    assert system_names == {"BI", "财务"}


def test_cycle_safe(session):
    """有环图不会死循环。"""
    db, tables = session
    impact = downstream_impact(db, [tables["x.e"].id])
    names = {t.name for t in impact["tables"]}
    assert names == {"x.f"}


def test_leaf_table_no_impact(session):
    """叶子表无下游。"""
    db, tables = session
    impact = downstream_impact(db, [tables["x.g"].id])
    assert impact["tables"] == [] and impact["reports"] == [] and impact["systems"] == []


def test_multiple_seeds(session):
    """多起点 BFS 合并去重。"""
    db, tables = session
    impact = downstream_impact(db, [tables["dwd.b"].id, tables["ads.d"].id])
    names = {t.name for t in impact["tables"]}
    assert names == {"dws.c"}
