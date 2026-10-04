'use strict';

/**
 * HTTP 冒烟（单次服务）：
 * 1. 以随机端口在本进程启动真实 HTTP 服务；
 * 2. 校验健康响应、首页与 Worker 资源可达；
 * 3. 通过 /api/match 实际运行三类本题输入：
 *    - 含奇环的一般图缩花成功；
 *    - 星型图失败并给出满足严格不等式的 Tutte 证书；
 *    - 非法输入（自环 / 奇数通道 / 未知端点 / 空边图）被明确拒绝。
 * 全部通过后以退出码 0 结束，任一失败以退出码 1 结束并关闭服务。
 */
process.env.PORT = process.env.PORT || '0';
process.env.HOST = process.env.HOST || '127.0.0.1';

const fs = require('node:fs');
const path = require('node:path');

const failures = [];
function check(cond, message) {
  if (cond) {
    console.log(`  ✓ ${message}`);
  } else {
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

async function postMatch(base, channels, edges) {
  const resp = await fetch(`${base}/api/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channels, edges }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function main() {
  if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
    throw new Error('dist/ 不存在，请先执行构建（npm run build）');
  }

  const server = require('./server');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`[smoke] 服务已启动：${base}`);

  // --- 健康响应 ---
  console.log('[smoke] 1) 健康响应 GET /health');
  const health = await (await fetch(`${base}/health`)).json();
  check(health.status === 'ok', '健康状态 status=ok');

  // --- 静态资源 ---
  console.log('[smoke] 2) 静态资源');
  const indexResp = await fetch(`${base}/`);
  const indexHtml = await indexResp.text();
  check(indexResp.status === 200 && indexHtml.includes('Edmonds'), '首页 200 且包含算法说明');
  const workerResp = await fetch(`${base}/worker.js`);
  const workerJs = await workerResp.text();
  check(workerResp.status === 200 && workerJs.includes('importScripts'), 'worker.js 200 且使用 importScripts');
  const algResp = await fetch(`${base}/matching.js`);
  check(algResp.status === 200 && (await algResp.text()).includes('perfectMatching'), 'matching.js 200 且暴露 perfectMatching');

  // --- 本题输入 A：双三角花，必须缩花才能成功 ---
  console.log('[smoke] 3) 缩花成功输入（两个三角奇环经一条桥连接）');
  const blossom = await postMatch(
    base,
    'A1 A2 A3 B1 B2 B3',
    'A1 A2\nA2 A3\nA3 A1\nB1 B2\nB2 B3\nB3 B1\nA1 B1'
  );
  check(blossom.valid === true && blossom.matched === true, '服务端判定可完整配对');
  check(Array.isArray(blossom.pairs) && blossom.pairs.length === 3, `返回 3 对配对（实际 ${blossom.pairs?.length}）`);
  const ids = new Set();
  let pairsAreSorted = true;
  let prev = '';
  for (const [a, b] of blossom.pairs) {
    ids.add(a); ids.add(b);
    if (!(a < b)) pairsAreSorted = false;
    if (a < prev) pairsAreSorted = false;
    prev = a;
  }
  check(ids.size === 6, '6 个通道全部被覆盖且无重复');
  check(pairsAreSorted, '配对按通道标识升序稳定排序');
  const edgeSet = new Set(['A1 A2', 'A2 A3', 'A1 A3', 'B1 B2', 'B2 B3', 'B1 B3', 'A1 B1']);
  check(blossom.pairs.every(([a, b]) => edgeSet.has(`${a} ${b}`)), '每一对均为录入的兼容边');

  // --- 本题输入 B：星型 K1,3，失败 + Tutte 证书 ---
  console.log('[smoke] 4) 无法配对输入（星型 K1,3）与失败证书');
  const star = await postMatch(base, 'C0 C1 C2 C3', 'C0 C1\nC0 C2\nC0 C3');
  check(star.valid === true && star.matched === false, '服务端判定无法完整配对');
  const cert = star.certificate;
  check(Array.isArray(cert.removed) && cert.removed.length === 1 && cert.removed[0] === 'C0',
    `移除集合 S={C0}（实际 {${cert.removed?.join(',')}}）`);
  check(cert.oddComponents.length === 3,
    `奇数连通分量数为 3（实际 ${cert.oddComponents?.length}）`);
  check(cert.oddComponents.every((c) => c.length === 1), '3 个奇分量均为单点孤立通道');
  check(cert.oddComponents.length > cert.removed.length,
    `严格不等式 ${cert.oddComponents.length} > ${cert.removed.length}`);
  check(cert.checks.length >= 5 && cert.checks.every((k) => k.ok),
    '证书逐项核对（划分/连通/无跨边/奇数/严格不等式）全部通过');

  // --- 非法输入 ---
  console.log('[smoke] 5) 非法输入的明确反馈');
  const selfLoop = await postMatch(base, 'A B C D', 'A A\nA B\nC D');
  check(selfLoop.valid === false && selfLoop.errors.some((e) => e.includes('自环')), '自环被拒绝并给出原因');

  const oddCount = await postMatch(base, 'A B C', 'A B\nB C');
  check(oddCount.valid === false && oddCount.errors.some((e) => e.includes('偶数')), '奇数个通道被拒绝');

  const unknown = await postMatch(base, 'A B C D', 'A B\nB X');
  check(unknown.valid === false && unknown.errors.some((e) => e.includes('未知端点')), '未知端点被拒绝');

  const dup = await postMatch(base, 'A B C D', 'A B\nB A\nC D');
  check(dup.valid === false && dup.errors.some((e) => e.includes('重复')), '重复边被拒绝');

  const emptyEdges = await postMatch(base, 'A B C D', '');
  check(emptyEdges.valid === false && emptyEdges.errors.some((e) => e.includes('空边图')), '空边图被拒绝');

  const tooMany = await postMatch(base, Array.from({ length: 50 }, (_, i) => `N${i}`).join(' '), '');
  check(tooMany.valid === false && tooMany.errors.some((e) => e.includes('3–48')), '超过 48 个通道被拒绝');

  server.close();
  if (failures.length) {
    console.error(`\n[smoke] 失败 ${failures.length} 项：\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\n[smoke] 全部通过，服务以退出码 0 结束。');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] 异常退出：', err);
  process.exit(1);
});
