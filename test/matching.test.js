'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { perfectMatching } = require('../src/matching');

/** 暴力回溯：是否存在完美匹配（小图基准） */
function bruteHasPerfect(n, edges) {
  const adj = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }
  const used = new Array(n).fill(false);
  function dfs() {
    let i = 0;
    while (i < n && used[i]) i++;
    if (i === n) return true;
    used[i] = true;
    for (const j of adj[i]) {
      if (used[j]) continue;
      used[j] = true;
      if (dfs()) return true;
      used[j] = false;
    }
    used[i] = false;
    return false;
  }
  return n % 2 === 0 && dfs();
}

/** 校验返回的配对确实合法且覆盖全部顶点，且每对都是图上边 */
function assertValidMatching(n, edges, pairs) {
  const edgeSet = new Set(edges.map(([u, v]) => `${Math.min(u, v)} ${Math.max(u, v)}`));
  assert.equal(pairs.length, n / 2);
  const seen = new Set();
  for (const [a, b] of pairs) {
    assert.ok(a >= 0 && b >= 0 && a < n && b < n, '下标越界');
    assert.notEqual(a, b, '出现自环配对');
    assert.ok(edgeSet.has(`${a} ${b}`), `配对 (${a},${b}) 不是图上边`);
    assert.ok(!seen.has(a) && !seen.has(b), '顶点被重复使用');
    seen.add(a);
    seen.add(b);
  }
  assert.equal(seen.size, n, '未覆盖全部顶点');
}

function allGraphs(n) {
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  const out = [];
  const m = pairs.length;
  for (let mask = 0; mask < 1 << m; mask++) {
    const es = [];
    for (let k = 0; k < m; k++) if (mask & (1 << k)) es.push(pairs[k]);
    out.push(es);
  }
  return out;
}

test('n=2 全部 2 种图', () => {
  for (const edges of allGraphs(2)) {
    const r = perfectMatching(2, edges);
    assert.equal(r.matched, bruteHasPerfect(2, edges));
    if (r.matched) assertValidMatching(2, edges, r.matching);
  }
});

test('n=4 全部 64 种图与暴力一致', () => {
  let checked = 0;
  for (const edges of allGraphs(4)) {
    const r = perfectMatching(4, edges);
    assert.equal(r.matched, bruteHasPerfect(4, edges), `图 ${JSON.stringify(edges)} 判定不一致`);
    if (r.matched) assertValidMatching(4, edges, r.matching);
    checked++;
  }
  assert.equal(checked, 64);
});

test('n=6 全部 32768 种图与暴力一致，失败均带合法证书', () => {
  const graphs = allGraphs(6);
  let okCount = 0;
  let failCount = 0;
  for (const edges of graphs) {
    const r = perfectMatching(6, edges);
    const expect = bruteHasPerfect(6, edges);
    assert.equal(r.matched, expect, `图 ${JSON.stringify(edges)} 判定不一致`);
    if (r.matched) {
      assertValidMatching(6, edges, r.matching);
      okCount++;
    } else {
      failCount++;
      const c = r.certificate;
      assert.ok(c.oddComponents.length > c.removed.length, 'Tutte 严格不等式不成立');
      assertCertificateMatchesGraph(6, edges, c);
    }
  }
  assert.ok(okCount > 0 && failCount > 0);
});

/** 独立于算法：证书的分量必须恰好是 G-S 的连通分量，且全部奇数 */
function assertCertificateMatchesGraph(n, edges, cert) {
  const inS = new Array(n).fill(false);
  for (const v of cert.removed) {
    assert.ok(v >= 0 && v < n);
    inS[v] = true;
  }
  const adj = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    adj[u].push(v);
    adj[v].push(u);
  }
  // 求真实连通分量
  const real = [];
  const seen = new Array(n).fill(false);
  for (let s = 0; s < n; s++) {
    if (seen[s] || inS[s]) continue;
    const comp = [];
    const st = [s];
    seen[s] = true;
    while (st.length) {
      const x = st.pop();
      comp.push(x);
      for (const y of adj[x]) if (!seen[y] && !inS[y]) { seen[y] = true; st.push(y); }
    }
    if (comp.length % 2 === 1) {
      comp.sort((a, b) => a - b);
      real.push(comp);
    }
  }
  const norm = (cs) =>
    cs
      .map((c) => c.slice().sort((a, b) => a - b).join(','))
      .sort()
      .join('|');
  assert.equal(norm(cert.oddComponents), norm(real), '证书奇分量与原图 G-S 的奇分量不一致');
}

test('随机图 fuzz（n=4..12）与暴力一致，合法证书', () => {
  let seed = 20261004;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  for (let iter = 0; iter < 1200; iter++) {
    const n = 2 * (2 + Math.floor(rand() * 5)); // 4,6,8,10,12
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    const p = 0.15 + rand() * 0.5;
    const edges = pairs.filter(() => rand() < p);
    const r = perfectMatching(n, edges);
    assert.equal(r.matched, bruteHasPerfect(n, edges));
    if (r.matched) assertValidMatching(n, edges, r.matching);
    else {
      assert.ok(r.certificate.oddComponents.length > r.certificate.removed.length);
      assertCertificateMatchesGraph(n, edges, r.certificate);
    }
  }
});

test('经典特例：星型 K1,3 失败，S={中心}，3 个单点奇分量', () => {
  const r = perfectMatching(4, [[0, 1], [0, 2], [0, 3]]);
  assert.equal(r.matched, false);
  assert.deepEqual(r.certificate.removed, [0]);
  assert.deepEqual(r.certificate.oddComponents, [[1], [2], [3]]);
});

test('经典特例：三角花+孤立点失败，S=∅，奇分量为 {三角} 与 {孤立点}', () => {
  const r = perfectMatching(4, [[0, 1], [1, 2], [2, 0]]);
  assert.equal(r.matched, false);
  assert.deepEqual(r.certificate.removed, []);
  const comps = r.certificate.oddComponents.map((c) => c.join(',')).sort();
  assert.deepEqual(comps, ['0,1,2', '3']);
});

test('经典特例：K1,5（6 点）失败，移除中心后 5 个单点 > 1', () => {
  const edges = [];
  for (let i = 1; i <= 5; i++) edges.push([0, i]);
  const r = perfectMatching(6, edges);
  assert.equal(r.matched, false);
  assert.deepEqual(r.certificate.removed, [0]);
  assert.equal(r.certificate.oddComponents.length, 5);
});

test('缩花必要性：双三角花经单桥相连（n=6）完美匹配', () => {
  const edges = [
    [0, 1], [1, 2], [2, 0],
    [3, 4], [4, 5], [5, 3],
    [0, 3],
  ];
  const r = perfectMatching(6, edges);
  assert.equal(r.matched, true);
  assertValidMatching(6, edges, r.matching);
});

test('Petersen 图（n=10）存在完美匹配', () => {
  const edges = [];
  for (let i = 0; i < 5; i++) {
    edges.push([i, (i + 1) % 5]);
    edges.push([5 + i, 5 + ((i + 2) % 5)]);
    edges.push([i, 5 + i]);
  }
  const r = perfectMatching(10, edges);
  assert.equal(r.matched, true);
  assertValidMatching(10, edges, r.matching);
});

test('n=48 完全图：快速返回 24 对', () => {
  const edges = [];
  for (let i = 0; i < 48; i++) for (let j = i + 1; j < 48; j++) edges.push([i, j]);
  const t0 = Date.now();
  const r = perfectMatching(48, edges);
  assert.equal(r.matched, true);
  assertValidMatching(48, edges, r.matching);
  assert.ok(Date.now() - t0 < 5000, '48 点完全图求解超时');
});

test('n=48 无边图（偶数孤立点）：失败证书 S=∅，48 个单点奇分量', () => {
  const r = perfectMatching(48, []);
  assert.equal(r.matched, false);
  assert.deepEqual(r.certificate.removed, []);
  assert.equal(r.certificate.oddComponents.length, 48);
  assert.ok(r.certificate.oddComponents.every((c) => c.length === 1));
});

test('重复边不影响结果', () => {
  const edges = [[0, 1], [0, 1], [1, 2], [2, 3], [3, 0], [0, 3]];
  const r = perfectMatching(4, edges);
  assert.equal(r.matched, true);
  assertValidMatching(4, [[0, 1], [1, 2], [2, 3], [3, 0]], r.matching);
});

test('大 n fuzz（14–24）：无挂起，结果与证书均可独立核验', () => {
  let seed = 991773;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let iter = 0; iter < 200; iter++) {
    const n = 2 * (7 + Math.floor(rand() * 6)); // 14..24
    const edges = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rand() < 0.18 + rand() * 0.25) edges.push([i, j]);
      }
    }
    const t0 = Date.now();
    const r = perfectMatching(n, edges);
    assert.ok(Date.now() - t0 < 3000, `n=${n} 求解超时`);
    if (r.matched) {
      assertValidMatching(n, edges, r.matching);
    } else {
      assert.ok(r.certificate.oddComponents.length > r.certificate.removed.length);
      assertCertificateMatchesGraph(n, edges, r.certificate);
    }
  }
});
