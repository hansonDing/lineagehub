#!/usr/bin/env python3
"""静态服务 dist,SPA fallback:未知路径回退 index.html;/api/* 仍返回 404(触发前端演示模式)"""
import http.server
import os

DIST = os.path.join(os.path.dirname(__file__), '..', 'dist')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def send_head(self):
        path = self.translate_path(self.path)
        if self.path.startswith('/api/'):
            self.send_error(404)
            return None
        if not os.path.exists(path) and not self.path.startswith('/assets/'):
            self.path = '/index.html'
        return super().send_head()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 4173), Handler).serve_forever()
