"""FastAPI 入口:CORS、/api 路由挂载、静态托管 dist(SPA fallback)。"""
import os
import sys
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.database import DB_PATH, SessionLocal, init_db
from backend.app.routers import (
    auth,
    changes,
    dashboard,
    lineage,
    reports,
    scripts,
    systems,
    tables,
)
from backend.app.seed import seed_if_empty

# 前端构建产物目录:默认仓库根的 dist(即 backend/../dist),可用环境变量覆盖
DIST_DIR = Path(
    os.environ.get("DIST_DIR", str(Path(__file__).resolve().parents[2] / "dist"))
).resolve()


# 启动错误记录:即使初始化失败也让进程存活,/api/health 会暴露原因
STARTUP_ERROR: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动:建表;DB 为空时自动灌入演示数据。失败不致命,写入 STARTUP_ERROR。"""
    global STARTUP_ERROR
    try:
        init_db()
        db = SessionLocal()
        try:
            seed_if_empty(db)
        finally:
            db.close()
    except Exception:  # noqa: BLE001 启动期任何异常都不能让进程退出
        STARTUP_ERROR = traceback.format_exc()
        print(STARTUP_ERROR, file=sys.stderr)
    yield


app = FastAPI(title="LineageHub 数据血缘平台", lifespan=lifespan)

# 开发用:CORS 全开
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------- API 路由
# 演示级假鉴权:只提供登录/验签端点,不保护既有业务端点
app.include_router(auth.router, prefix="/api")
app.include_router(systems.router, prefix="/api")
app.include_router(tables.router, prefix="/api")
app.include_router(scripts.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(lineage.router, prefix="/api")
app.include_router(changes.router, prefix="/api")
app.include_router(changes.approvals_router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")


@app.get("/api/health")
def health():
    """健康检查 + 部署自诊断(DB 路径/可写性/表计数/启动错误)。"""
    info: dict = {"status": "ok" if STARTUP_ERROR is None else "degraded", "db_path": str(DB_PATH)}
    if STARTUP_ERROR is not None:
        info["startup_error"] = STARTUP_ERROR[-2000:]
        return info
    try:
        from backend.app.models import DataTable

        db = SessionLocal()
        try:
            info["table_count"] = db.query(DataTable).count()
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001
        info["status"] = "error"
        info["db_error"] = repr(exc)
    return info


# ---------------------------------------------------------------- 静态托管
if DIST_DIR.is_dir():
    # Vite 构建的静态资源目录
    assets_dir = DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA fallback:非 /api 路径都返回 index.html。"""
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(404, "Not Found")
        candidate = (DIST_DIR / full_path).resolve()
        # 防目录穿越;存在的真实文件直接返回(如 favicon.svg)
        if full_path and candidate.is_file() and str(candidate).startswith(str(DIST_DIR)):
            return FileResponse(candidate)
        index = DIST_DIR / "index.html"
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(404, "前端产物不存在,请先执行 npm run build")
else:

    @app.get("/", include_in_schema=False)
    def root():
        return {"message": "LineageHub 数据血缘平台 API", "docs": "/docs"}
