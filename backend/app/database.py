"""数据库连接与会话管理(SQLite + SQLAlchemy)。"""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# SQLite 文件默认放在 backend/lineage.db(以本文件位置为基准,与启动目录无关)
# 可用环境变量 LINEAGE_DB_PATH 覆盖(测试时使用临时库)
# 部署环境(如只读文件系统容器)下 backend/ 目录不可写时,自动回退到系统临时目录
import tempfile


def _pick_db_path() -> Path:
    env = os.environ.get("LINEAGE_DB_PATH")
    if env:
        return Path(env)
    candidate = Path(__file__).resolve().parents[1] / "lineage.db"
    try:
        candidate.parent.mkdir(parents=True, exist_ok=True)
        # 探测可写性(无内容写入)
        with open(candidate, "a", encoding="utf-8"):
            pass
        return candidate
    except OSError:
        return Path(tempfile.gettempdir()) / "lineage.db"


DB_PATH = _pick_db_path()

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},  # FastAPI 多线程访问 SQLite 需要
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    """FastAPI 依赖:每请求一个会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_change_events(eng):
    """轻量迁移:为旧库的 change_events 表补 source / source_detail 列(幂等)。"""
    from sqlalchemy import text

    try:
        with eng.begin() as conn:
            cols = {
                row[1]
                for row in conn.execute(text("PRAGMA table_info(change_events)")).fetchall()
            }
            if not cols:
                return  # 表不存在(create_all 会建)
            if "source" not in cols:
                conn.execute(
                    text("ALTER TABLE change_events ADD COLUMN source VARCHAR DEFAULT 'manual'")
                )
            if "source_detail" not in cols:
                conn.execute(
                    text("ALTER TABLE change_events ADD COLUMN source_detail TEXT DEFAULT '{}'")
                )
    except Exception:  # noqa: BLE001 迁移失败不阻断启动(列已存在等情况)
        pass


def init_db():
    """建表(幂等)+ 旧库轻量迁移。"""
    from backend.app import models  # noqa: F401  确保模型已注册

    Base.metadata.create_all(bind=engine)
    _migrate_change_events(engine)
