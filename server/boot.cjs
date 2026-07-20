// LineageHub 预览运行时引导:零依赖 Node 静态服务器
// 预览平台以 `node dist/boot.js` 启动本文件(postbuild 从 server/boot.cjs 拷贝)
// 真实全栈部署请用根目录 Dockerfile(FastAPI 托管 dist + /api)
// 本服务器只托管静态前端;/api/* 返回 503,前端会自动降级到浏览器内置演示模式
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname; // dist/
const PORT = Number(process.env.PORT || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    // API 不可达:503 触发前端演示模式降级(4xx 不会触发,必须 5xx)
    if (urlPath.startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ detail: 'preview backend unavailable, frontend demo mode takes over' }));
      return;
    }

    let file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    // SPA fallback:非静态资源路径一律回退 index.html
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ detail: String(err) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LineageHub preview server listening on :${PORT}`);
});
