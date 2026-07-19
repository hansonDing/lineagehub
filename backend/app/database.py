"""数据库连接与会话管理(SQLite + SQLAlchemy)。"""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# SQLite 文件默认放在 backend/lineage.db(以本文件位置为基准,与启动目录无关)
# 可用环境变量 LINEAGE_DB_PATH 覆盖(测试时使用临时库)
_DEFAULT_DB = Path(__file__).resolve().parents[1] / "lineage.db"
DB_PATH = Path(os.environ.get("LINEAGE_DB_PATH", str(_DEFAULT_DB)))

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


def init_db():
    """建表(幂等)。"""
    from backend.app import models  # noqa: F401  确保模型已注册

    Base.metadata.create_all(bind=engine)
