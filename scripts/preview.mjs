import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 8790);
const prefix = (process.argv.find(a => a.startsWith('--prefix='))?.slice(9) || '').replace(/\/$/, '');
if (prefix && !/^\/[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Invalid preview prefix.');
const blocked = new Set(['node_modules', '__pycache__', 'outputs', 'inputs', 'runs', 'private', 'private-jobs', 'models', 'weights', 'checkpoints']);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.py':'text/plain; charset=utf-8'};
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { req.resume(); res.writeHead(405); res.end('Static preview only'); return; }
    const url = new URL(req.url, 'http://localhost');
    const full = decodeURIComponent(url.pathname);
    if (prefix && full === prefix) { res.writeHead(302, {Location: prefix + '/' + url.search}); res.end(); return; }
    if (prefix && !full.startsWith(prefix + '/')) { res.writeHead(404); res.end('Not found'); return; }
    const pathname = prefix ? full.slice(prefix.length) : full;
    if (pathname.includes('\\') || pathname.split('/').some(p => p.startsWith('.') || blocked.has(p))) { res.writeHead(403); res.end('Not served'); return; }
    let filename = path.resolve(root, '.' + pathname);
    const stat = await fs.stat(filename);
    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(302, {Location: full + '/' + url.search}); res.end(); return; }
      filename = path.join(filename, 'index.html');
    }
    const real = await fs.realpath(filename);
    if (!real.startsWith(root + path.sep) && real !== root) { res.writeHead(403); res.end('Not served'); return; }
    const bytes = await fs.readFile(real);
    res.writeHead(200, {'Content-Type': mime[path.extname(real)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 400);
    res.end('Not found or invalid path');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}${prefix}/ (no GPU/API or photo uploads)`));
