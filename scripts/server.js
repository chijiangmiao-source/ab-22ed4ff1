'use strict';

/**
 * 零依赖静态站点服务器 + 匹配 HTTP API。
 *
 * - 页面 / Web Worker 等静态资源由 dist 提供；
 * - GET  /health 健康响应；
 * - POST /api/match 在服务端复用与 Web Worker 完全相同的
 *   matching.js / parse.js 规则（用于 HTTP 冒烟与外部核验）；
 *   浏览器页面本身始终在 Web Worker 中计算，不调用本接口。
 *
 * 端口 / 监听地址可由环境变量配置：HOST、PORT。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { parseInput, presentPairs, verifyCertificate } = require('../src/parse');
const { perfectMatching } = require('../src/matching');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const DIST = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(DIST, rel));
  if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found', path: rel });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('请求体超过 1MB 限制'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleMatch(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req) || '{}');
  } catch {
    sendJson(res, 400, { ok: false, errors: ['请求体不是合法 JSON'] });
    return;
  }
  const parsed = parseInput(String(payload.channels ?? ''), String(payload.edges ?? ''));
  if (parsed.errors.length) {
    sendJson(res, 200, { ok: true, valid: false, errors: parsed.errors });
    return;
  }
  const result = perfectMatching(parsed.channels.length, parsed.edges);
  if (result.matched) {
    sendJson(res, 200, {
      ok: true,
      valid: true,
      matched: true,
      channels: parsed.channels,
      pairs: presentPairs(parsed.channels, result.matching),
    });
    return;
  }
  const cert = result.certificate;
  sendJson(res, 200, {
    ok: true,
    valid: true,
    matched: false,
    channels: parsed.channels,
    certificate: {
      removed: cert.removed.map((i) => parsed.channels[i]),
      oddComponents: cert.oddComponents.map((comp) => comp.map((i) => parsed.channels[i])),
      checks: verifyCertificate(parsed.channels.length, parsed.edges, cert.removed, cert.oddComponents),
    },
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'relay-channel-matching', time: new Date().toISOString() });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/match') {
    handleMatch(req, res).catch((err) => sendJson(res, 500, { ok: false, errors: [String(err && err.message || err)] }));
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }
  sendJson(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, HOST, () => {
  const actual = server.address();
  console.log(`[relay-matching] listening on http://${HOST}:${actual.port} (serving ${DIST})`);
});

module.exports = server;
