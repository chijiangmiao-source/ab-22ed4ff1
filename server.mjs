// 零依赖静态服务器：托管构建产物，提供 /healthz 健康响应与 /api/match 复核接口。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { solveText } from './src/matching.js';

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const ALLOWED_FILES = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/worker.js',
  '/matching.js',
  '/build-manifest.json',
]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // 白名单 + basename 解析，杜绝路径穿越
  if (!ALLOWED_FILES.has(pathname) || pathname.includes('..')) {
    sendJson(res, 404, { status: 'error', message: '资源不存在' });
    return;
  }

  const filePath = path.join(DIST_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': pathname === '/build-manifest.json' ? 'no-store' : 'public, max-age=300',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, {
      status: 'error',
      message: '资源尚未构建，请先运行 npm run build',
    });
  }
}

async function handleApiMatch(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { status: 'error', message: '仅支持 POST' });
    return;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1_000_000) {
      sendJson(res, 413, { status: 'error', message: '请求体过大' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { status: 'error', message: '请求体不是合法 JSON' });
    return;
  }
  const result = solveText(String(payload.channels ?? ''), String(payload.edges ?? ''));
  sendJson(res, 200, result);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'relay-channel-matching',
      time: new Date().toISOString(),
    });
    return;
  }
  if (url.pathname === '/api/match') {
    handleApiMatch(req, res).catch((err) => {
      sendJson(res, 500, { status: 'error', message: err.message });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { status: 'error', message: '方法不允许' });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[relay-matching] listening on http://${HOST}:${PORT} (serving ${DIST_DIR})`);
});

const shutdown = (signal) => {
  console.log(`[relay-matching] received ${signal}, shutting down`);
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
