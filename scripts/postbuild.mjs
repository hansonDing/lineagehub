// 构建收尾:把预览平台引导服务器拷进 dist(平台以 `node dist/boot.js` 启动)
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('server/boot.mjs', 'dist/boot.js');
console.log('postbuild: dist/boot.js ready');
