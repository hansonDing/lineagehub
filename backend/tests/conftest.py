"""pytest 配置:API 测试使用独立临时 SQLite,避免污染本地 lineage.db。

注意:必须在导入任何 backend.app 模块前设置环境变量
(database.py 在导入时创建 engine)。
"""
import os
import tempfile

_TMP_DIR = tempfile.mkdtemp(prefix="lineage_test_")
os.environ["LINEAGE_DB_PATH"] = os.path.join(_TMP_DIR, "test_lineage.db")
