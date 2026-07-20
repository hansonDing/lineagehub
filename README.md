# LineageHub · 数据血缘平台

让每一条数据血缘清晰可见。提交 SQL 自动构建表级血缘，变更影响一屏尽览。

- **SQL 自动解析**：基于 sqlglot(Spark SQL 方言),支持 `CREATE TABLE` / CTAS / `CREATE VIEW` / `INSERT OVERWRITE|INTO` / `ALTER TABLE` / 裸 SELECT(含 CTE、JOIN、UNION)
- **血缘图谱**：分层自动布局，悬停高亮上下游链路(上游蓝 / 下游金)+ 流动动画，聚焦模式按跳数追溯
- **元数据管理**：维护业务系统、数仓表、报表的归属与负责人
- **变更影响分析 + 审批流**：上游 DDL / SQL 变更时自动计算受影响报表与下游系统，通知各负责人，全部审批通过才生效
- **开箱即用**：内置演示数据、7 个预置用户、中英文双语、无后端时浏览器端演示模式自动降级

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind CSS 3.4 + shadcn/ui + @xyflow/react |
| 后端 | Python 3.12 + FastAPI + SQLAlchemy 2 + SQLite |
| 解析引擎 | sqlglot 30.12(`dialect = spark`) |
| 部署 | 单 Dockerfile 多阶段构建(Node 构建前端 → Python 运行时托管静态文件 + API) |

## 架构说明

后端 uvicorn 进程同时承担两个角色:

1. **API 服务**:`/api/*`(血缘、元数据、变更、审批、鉴权)
2. **静态托管**:托管前端构建产物 `dist/`,并对非 `/api` 路径做 SPA fallback

因此**整套系统只需要一个进程、一个端口**,这是所有部署方式的核心。

数据库为单个 SQLite 文件(默认 `backend/lineage.db`,可用 `LINEAGE_DB_PATH` 覆盖)。首次启动自动建表并写入演示种子数据。

---

## 方式一:Docker 部署(推荐)

### 1. 构建镜像

在项目根目录(含 `Dockerfile`)执行:

```bash
docker build -t lineagehub:latest .
```

### 2. 运行容器

```bash
docker run -d \
  --name lineagehub \
  -p 8000:8000 \
  -e AUTH_PASSWORD=lineagehub123 \
  -v lineagehub-data:/app/backend-data \
  -e LINEAGE_DB_PATH=/app/backend-data/lineage.db \
  lineagehub:latest
```

| 参数 | 说明 |
|---|---|
| `-p 8000:8000` | 容器内服务端口为 `8000`(由 `PORT` 环境变量决定,可改) |
| `AUTH_PASSWORD` | 所有预置用户的统一登录密码,默认 `lineagehub123` |
| `LINEAGE_DB_PATH` + 卷挂载 | **强烈建议**:把 SQLite 文件放到挂载卷里,容器重建后数据不丢。不挂载则数据随容器删除而丢失 |

### 3. 验证

```bash
curl http://localhost:8000/api/health
# {"status":"ok","db_path":"/app/backend-data/lineage.db",...}
```

浏览器打开 `http://localhost:8000`,选择任一用户(如 Leo),输入密码登录。

### 4. docker-compose(可选)

```yaml
services:
  lineagehub:
    build: .
    ports:
      - "8000:8000"
    environment:
      AUTH_PASSWORD: lineagehub123
      LINEAGE_DB_PATH: /app/backend-data/lineage.db
    volumes:
      - lineagehub-data:/app/backend-data
    restart: unless-stopped

volumes:
  lineagehub-data:
```

```bash
docker compose up -d --build
```

### 5. 升级 / 重建

```bash
git pull
docker build -t lineagehub:latest .
docker stop lineagehub && docker rm lineagehub
# 用上面同样的 docker run 命令重新启动(数据在卷里,不受影响)
```

---

## 方式二:VM / 裸机部署(Ubuntu 22.04 示例)

适合没有 Docker 的虚拟机或物理机。需要一个 Python 3.12 运行时 + 一次性的 Node 20 构建环境。

### 1. 安装依赖

```bash
# Python 3.12(Ubuntu 22.04 默认源为 3.10,用 deadsnakes)
sudo apt update
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt install -y python3.12 python3.12-venv

# Node.js 20(仅构建前端时需要)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. 拉取代码并构建前端

```bash
git clone https://github.com/hansonDing/lineagehub.git
cd lineagehub
npm install
npm run build        # 产物在 dist/
```

### 3. 安装后端依赖

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 4. 启动

```bash
# 在项目根目录执行;DIST_DIR 默认指向项目根的 dist/,无需额外设置
AUTH_PASSWORD=lineagehub123 \
LINEAGE_DB_PATH=/var/lib/lineagehub/lineage.db \
nohup .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 \
  > /var/log/lineagehub.log 2>&1 &
```

> 使用自定义 `LINEAGE_DB_PATH` 前先 `sudo mkdir -p /var/lib/lineagehub` 并确保运行用户有写权限。

验证:`curl http://localhost:8000/api/health` 返回 `status: ok` 即可。

### 5. systemd 托管(生产推荐)

新建 `/etc/systemd/system/lineagehub.service`:

```ini
[Unit]
Description=LineageHub Data Lineage Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/lineagehub
Environment=AUTH_PASSWORD=lineagehub123
Environment=LINEAGE_DB_PATH=/var/lib/lineagehub/lineage.db
Environment=PORT=8000
ExecStart=/opt/lineagehub/.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lineagehub
sudo systemctl status lineagehub
```

### 6. nginx 反向代理(可选,绑定域名 / 80 端口)

```nginx
server {
    listen 80;
    server_name lineagehub.example.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 方式三:Windows 本机部署

### 前置条件

1. **Python 3.12**:从 [python.org](https://www.python.org/downloads/) 下载安装,安装时勾选 **"Add python.exe to PATH"**
2. **Node.js 20 LTS**:从 [nodejs.org](https://nodejs.org/) 下载安装
3. 打开 **PowerShell**(建议管理员),确认:

```powershell
python --version   # 3.12.x
node --version     # v20.x
```

### A. 生产模式(单进程,和 Docker 行为一致)

```powershell
# 1. 拉取代码
git clone https://github.com/hansonDing/lineagehub.git
cd lineagehub

# 2. 构建前端(生成 dist\ 目录)
npm install
npm run build

# 3. 安装后端依赖
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt

# 4. 启动(后端会同时托管 dist\ 静态文件和 /api)
$env:AUTH_PASSWORD = "lineagehub123"
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

浏览器打开 **http://localhost:8000**。

> 如果 `Activate.ps1` 被策略拦截,先执行一次:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
> 或者改用 `.\.venv\Scripts\activate.bat`(CMD)。

### B. 开发模式(前后端分离,热更新)

开两个 PowerShell 窗口:

```powershell
# 窗口 1:后端(端口 8000)
cd lineagehub
.\.venv\Scripts\Activate.ps1
uvicorn backend.app.main:app --reload --port 8000
```

```powershell
# 窗口 2:前端 Vite 开发服务器(端口 3000,已配置 /api 代理到 8000)
cd lineagehub
npm run dev
```

浏览器打开 **http://localhost:3000**,改代码即时生效。

### Windows 常见问题

| 问题 | 解决 |
|---|---|
| `uvicorn` 不是命令 | 确认已激活 venv;或用完整路径 `.\.venv\Scripts\uvicorn.exe` |
| 端口被占用 | 换端口:`uvicorn ... --port 8080`,浏览器访问对应端口 |
| 杀毒软件拦截 SQLite 写入 | 把项目目录加入杀软白名单,或用 `$env:LINEAGE_DB_PATH="D:\data\lineage.db"` 换到非系统盘目录 |

---

## 环境变量一览

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8000` | 服务监听端口(Docker 内默认 8000) |
| `AUTH_PASSWORD` | `lineagehub123` | 预置用户统一登录密码 |
| `LINEAGE_DB_PATH` | `backend/lineage.db` | SQLite 数据库文件路径 |
| `DIST_DIR` | 项目根 `dist/` | 前端构建产物目录(Docker 内为 `/app/dist`) |

## 预置账号

7 个预置用户,密码统一为 `AUTH_PASSWORD`(默认 `lineagehub123`):

| 用户 | 角色 |
|---|---|
| Leo / Doris | Data Engineer |
| Fiona | Data Analyst |
| Hanson / Jacky | System Owner |
| Jerry | BI Engineer |
| Maggie | Finance Analyst |

Token 有效期 24 小时,过期自动回到登录页。

## 演示模式(无后端也能跑)

前端内置了浏览器端演示引擎:当 `/api` 请求出现 5xx 或网络错误时,自动切换到 localStorage 中的演示数据继续完整功能(解析、变更、审批全部可用,数据只存在浏览器里)。因此**只部署静态文件也能演示**——适合产品预览环境。

## 项目结构

```
├── src/                  # 前端 React 源码
│   ├── pages/            # 总览 / 血缘图谱 / SQL 管理 / 元数据 / 变更审批 / 登录
│   ├── components/lineage/  # 血缘图谱组件(buildFlowGraph / dagre 布局)
│   └── lib/              # API 客户端、演示模式引擎、i18n(602 对中英 key)
├── backend/
│   ├── app/              # FastAPI 应用(路由、解析引擎 parser.py、影响分析、种子数据)
│   └── tests/            # 48 个 pytest(解析 / 影响分析 / API / 鉴权 / 批量导入)
├── Dockerfile            # 多阶段:Node 构建前端 → Python 运行时
└── README.md
```

## 运行测试

```bash
source .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pytest backend/tests -q          # 48 passed
```

## 故障排查

| 症状 | 排查 |
|---|---|
| 页面白屏但 `/api/health` 正常 | `DIST_DIR` 没指对:确认 `dist/` 存在且 `index.html` 在其中 |
| `/api` 全 404 | 用 `--app-dir` 或确认从项目根启动,import 路径是 `backend.app.main:app` |
| 登录 401 | 密码是 `AUTH_PASSWORD` 的值;没设过环境变量就是 `lineagehub123`(全小写半角) |
| 数据重启丢失 | Docker 没挂卷 / `LINEAGE_DB_PATH` 指到了临时目录 |
| 界面显示"演示模式"徽标 | 后端没起来或网络不通,前端已自动降级为浏览器演示数据 |
