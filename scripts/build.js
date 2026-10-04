'use strict';

/**
 * 页面构建：将 src 下的站点资源原样发布到 dist。
 * 不引入打包器——Worker 通过 importScripts 直接加载同构算法模块，
 * 保持“浏览器与 Node 跑同一份规则代码”。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const REQUIRED = ['index.html', 'styles.css', 'app.js', 'worker.js', 'matching.js', 'parse.js'];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(DIST);
copyDir(SRC, DIST);

const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(DIST, f)));
if (missing.length) {
  console.error('[build] 缺少必需文件：', missing.join(', '));
  process.exit(1);
}

// 简易完整性断言：页面引用的资源都存在，Worker 确实加载了算法模块
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
for (const ref of ['styles.css', 'app.js']) {
  if (!html.includes(ref)) throw new Error(`index.html 未引用 ${ref}`);
}
const worker = fs.readFileSync(path.join(DIST, 'worker.js'), 'utf8');
for (const ref of ['matching.js', 'parse.js']) {
  if (!worker.includes(`importScripts`) || !worker.includes(ref)) {
    throw new Error(`worker.js 未通过 importScripts 加载 ${ref}`);
  }
}
if (!worker.includes('perfectMatching')) throw new Error('worker.js 未调用 perfectMatching');

const files = fs.readdirSync(DIST);
console.log(`[build] 完成：${files.length} 个文件发布到 dist/（${files.join(', ')}）`);
