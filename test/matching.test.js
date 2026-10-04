// 匹配规则测试：
//   1. 输入解析与各类非法输入反馈
//   2. Edmonds 缩花在一般图（含奇环 / 花）上的正确性
//   3. 与指数级暴力枚举的最大匹配结果做随机对照
//   4. 失败证书独立复核（按原图重算连通分量、严格不等式、跨边全部存在）
import test from 'node:test';
import assert from 'node:assert/strict';
import { solveText, parseInput, validateInput } from '../src/matching.js';

const OK_SAMPLE = {
  channels: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'],
  edges: [
    ['C01', 'C02'], ['C01', 'C03'], ['C02', 'C03'],
    ['C03', 'C04'], ['C04', 'C05'], ['C04', 'C06'], ['C05', 'C06'],
  ],
};

const FAIL_SAMPLE = {
  channels: ['HUB', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1'],
  edges: [
    ['HUB', 'A1'], ['HUB', 'B1'], ['HUB', 'C1'],
    ['A1', 'A2'], ['A2', 'A3'], ['A3', 'A1'],
    ['B1', 'B2'], ['B2', 'B3'], ['B3', 'B1'],
  ],
};

function toText(graph) {
  return {
    channelText: graph.channels.join('\n'),
    edgeText: graph.edges.map(([a, b]) => `${a} ${b}`).join('\n'),
  };
}

function run(graph) {
  const { channelText, edgeText } = toText(graph);
  return solveText(channelText, edgeText);
}

function assertPerfect(result, vertices) {
  assert.equal(result.status, 'ok', `期望成功：${JSON.stringify(result).slice(0, 400)}`);
  const flat = result.pairs.flat().sort();
  assert.deepEqual(flat, [...vertices].sort(), '配对必须恰好覆盖全部通道各一次');
  const expected = [...result.pairs];
  const sorted = [...expected].sort((p, q) =>
    p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0);
  assert.deepEqual(result.pairs, sorted, '配对必须按通道标识稳定排序');
  for (const [a, b] of result.pairs) assert.ok(a < b, '每对内部也按标识排序');
}

// ---- 解析 ----------------------------------------------------------------

test('parseInput：空白/逗号/-- 分隔，忽略空行', () => {
  const { channels, edges, lineErrors } = parseInput(
    'a\n b \n\nc\nd\n',
    'a b\n c--d \nc，d\nb,c\n',
  );
  assert.deepEqual(channels, ['a', 'b', 'c', 'd']);
  assert.deepEqual(edges, [['a', 'b'], ['c', 'd'], ['c', 'd'], ['b', 'c']]);
  assert.deepEqual(lineErrors, []);
});

test('parseInput：无法解析的边行给出带行号的反馈', () => {
  const { lineErrors } = parseInput('a\nb\nc', 'a b c\n\na b');
  assert.equal(lineErrors.length, 1);
  assert.match(lineErrors[0].message, /第 1 行/);
});

// ---- 非法输入 ------------------------------------------------------------

test('自环被拒绝', () => {
  const r = run({ channels: ['a', 'b', 'c', 'd'], edges: [['a', 'a'], ['a', 'b'], ['c', 'd']] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'SELF_LOOP'));
});

test('重复边被拒绝（含顺序颠倒的无向重复）', () => {
  const r = run({
    channels: ['a', 'b', 'c', 'd'],
    edges: [['a', 'b'], ['b', 'a'], ['c', 'd']],
  });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'DUPLICATE_EDGE'));
});

test('未知端点被拒绝', () => {
  const r = run({ channels: ['a', 'b', 'c', 'd'], edges: [['a', 'x'], ['c', 'd']] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'UNKNOWN_ENDPOINT'));
  assert.match(r.errors.find((e) => e.code === 'UNKNOWN_ENDPOINT').message, /x/);
});

test('通道数为奇数被拒绝', () => {
  const r = run({ channels: ['a', 'b', 'c'], edges: [['a', 'b']] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'ODD_CHANNEL_COUNT'));
});

test('少于 3 个通道被拒绝', () => {
  const r = run({ channels: ['a', 'b'], edges: [['a', 'b']] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'TOO_FEW_CHANNELS'));
});

test('超过 48 个通道被拒绝', () => {
  const channels = Array.from({ length: 49 }, (_, i) => `N${i}`);
  const r = run({ channels, edges: [] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'TOO_MANY_CHANNELS'));
});

test('通道标识重复被拒绝', () => {
  const r = run({ channels: ['a', 'b', 'c', 'c'], edges: [['a', 'b'], ['c', 'a']] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'DUPLICATE_CHANNEL'));
});

test('空边图被拒绝', () => {
  const r = run({ channels: ['a', 'b', 'c', 'd'], edges: [] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'EMPTY_EDGE_GRAPH'));
});

test('边界：恰好 48 个通道且为偶数，校验通过', () => {
  const n = 48;
  const channels = Array.from({ length: n }, (_, i) => `V${String(i).padStart(2, '0')}`);
  const edges = [];
  for (let i = 0; i < n; i += 2) edges.push([channels[i], channels[i + 1]]);
  const r = run({ channels, edges });
  assert.equal(r.status, 'ok');
  assert.equal(r.pairs.length, n / 2);
});

test('validateInput 可独立使用', () => {
  const errors = validateInput(['a', 'b', 'c', 'd'], [['a', 'a']]);
  assert.ok(errors.some((e) => e.code === 'SELF_LOOP'));
});

// ---- 完美匹配（一般图，必须缩花） -----------------------------------------

test('三角形 + 三角形（奇环结构）存在完美匹配', () => {
  const g = {
    channels: ['0', '1', '2', '3', '4', '5'],
    edges: [
      ['0', '1'], ['1', '2'], ['2', '0'],
      ['3', '4'], ['4', '5'], ['5', '3'],
      ['2', '3'],
    ],
  };
  assertPerfect(run(g), g.channels);
});

test('K4 完全图存在完美匹配', () => {
  const ch = ['a', 'b', 'c', 'd'];
  const edges = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) edges.push([ch[i], ch[j]]);
  assertPerfect(run({ channels: ch, edges }), ch);
});

test('K_2m 完全图均存在完美匹配（m=2..7）', () => {
  for (const n of [4, 6, 8, 10, 12, 14]) {
    const ch = Array.from({ length: n }, (_, i) => `v${i}`);
    const edges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([ch[i], ch[j]]);
    assertPerfect(run({ channels: ch, edges }), ch);
  }
});

test('Petersen 图（3-正则一般图）存在完美匹配', () => {
  const ch = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const edges = [];
  const add = (a, b) => edges.push([ch[a], ch[b]]);
  for (let i = 0; i < 5; i++) {
    add(i, (i + 1) % 5);          // 外五边形
    add(5 + i, 5 + (i + 2) % 5);  // 内五角星
    add(i, 5 + i);                // 辐条
  }
  assertPerfect(run({ channels: ch, edges }), ch);
});

test('含嵌套缩花需求的经典花图找到完美匹配', () => {
  // 两个三角形共享一条“柄”结构，贪心可能误配，缩花增广后仍可完美匹配
  const ch = ['0', '1', '2', '3', '4', '5', '6', '7'];
  const edges = [
    ['0', '1'], ['1', '2'], ['2', '0'],   // 花 1
    ['2', '3'],                            // 柄
    ['3', '4'], ['4', '5'], ['5', '3'],   // 花 2
    ['5', '6'], ['6', '7'],
  ];
  assertPerfect(run({ channels: ch, edges }), ch);
});

test('题目内建可配对示例成功', () => {
  assertPerfect(run(OK_SAMPLE), OK_SAMPLE.channels);
});

test('三角形加孤立点（偶数总数）无完美匹配', () => {
  const g = {
    channels: ['0', '1', '2', 'iso'],
    edges: [['0', '1'], ['1', '2'], ['2', '0']],
  };
  const r = run(g);
  assert.equal(r.status, 'no-perfect');
  assert.ok(r.certificate.oddComponentCount > r.certificate.sSize);
});

test('题目内建失败示例无完美匹配', () => {
  const r = run(FAIL_SAMPLE);
  assert.equal(r.status, 'no-perfect');
  assert.equal(r.certificate.sSize, 1);
  assert.equal(r.certificate.oddComponentCount, 3);
  assert.deepEqual(r.certificate.s, ['HUB']);
  const sets = r.certificate.oddComponents.map((c) => c.vertices.join(','));
  assert.deepEqual(sets.sort(), ['A1,A2,A3', 'B1,B2,B3', 'C1']);
});

// ---- 证书独立复核 --------------------------------------------------------

// 完全不依赖被测实现的证书核对器：只凭原始图与证书内容验证。
function independentlyVerifyCertificate(graph, certificate) {
  const V = new Set(graph.channels);
  const edgeSet = new Set(graph.edges.map(([a, b]) => (a < b ? `${a}⇄${b}` : `${b}⇄${a}`)));
  const adj = new Map(graph.channels.map((v) => [v, new Set()]));
  for (const [a, b] of graph.edges) {
    adj.get(a).add(b);
    adj.get(b).add(a);
  }

  // 1. S 合法且无重复
  const S = certificate.s;
  assert.equal(new Set(S).size, S.length, 'S 中存在重复通道');
  for (const v of S) assert.ok(V.has(v), `S 含未知通道 ${v}`);
  const sSet = new Set(S);

  // 2. 独立 BFS 重算 G-S 的全部连通分量
  const seen = new Set();
  const allComponents = [];
  for (const start of graph.channels) {
    if (sSet.has(start) || seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const u of adj.get(v)) {
        if (!sSet.has(u) && !seen.has(u)) {
          seen.add(u);
          stack.push(u);
        }
      }
    }
    allComponents.push(comp.sort());
  }
  const bruteOdd = allComponents.filter((c) => c.length % 2 === 1)
    .map((c) => c.join(','))
    .sort();

  // 3. 证书给出的奇分量必须与独立重算结果逐项一致
  const certOdd = certificate.oddComponents.map((c) => c.vertices.join(','));
  assert.equal(new Set(certOdd).size, certOdd.length, '奇分量之间存在交叠');
  assert.deepEqual([...certOdd].sort(), bruteOdd, '奇分量必须等于 G-S 的全部奇数连通分量');

  for (const comp of certificate.oddComponents) {
    assert.equal(comp.size % 2, 1, '分量必须为奇数大小');
    assert.equal(comp.size, comp.vertices.length);
    // 4. 证书列出的每条跨边都必须真实存在于原图，且一端在 S、一端在该分量
    const vset = new Set(comp.vertices);
    for (const [a, b] of comp.edgesToS) {
      assert.ok(edgeSet.has(a < b ? `${a}⇄${b}` : `${b}⇄${a}`), `跨边 ${a}-${b} 在原图中不存在`);
      assert.ok(sSet.has(a) ? vset.has(b) : sSet.has(b) && vset.has(a),
        `跨边 ${a}-${b} 不满足一端在 S 一端在该分量`);
    }
    // 反向核对：该分量到 S 的所有原图边都应被列出
    const expectedCross = new Set();
    for (const v of comp.vertices) {
      for (const u of adj.get(v)) {
        if (sSet.has(u)) {
          const pair = u < v ? `${u}⇄${v}` : `${v}⇄${u}`;
          expectedCross.add(pair);
        }
      }
    }
    const actualCross = new Set(comp.edgesToS.map(([a, b]) => (a < b ? `${a}⇄${b}` : `${b}⇄${a}`)));
    assert.deepEqual([...actualCross].sort(), [...expectedCross].sort(), '跨边列举不完整或多余');
  }

  // 5. 严格不等式
  assert.ok(
    certificate.oddComponentCount > certificate.sSize,
    `证书不满足 q(S)=${certificate.oddComponentCount} > |S|=${certificate.sSize}`,
  );
  assert.equal(certificate.oddComponentCount, certificate.oddComponents.length);
  assert.equal(certificate.sSize, S.length);
}

test('失败示例证书可由原图逐项独立核对', () => {
  independentlyVerifyCertificate(FAIL_SAMPLE, run(FAIL_SAMPLE).certificate);
});

test('三角形加孤立点证书可独立核对', () => {
  const g = {
    channels: ['0', '1', '2', 'iso'],
    edges: [['0', '1'], ['1', '2'], ['2', '0']],
  };
  independentlyVerifyCertificate(g, run(g).certificate);
});

// ---- 随机图：与暴力最大匹配对照 ------------------------------------------

// 确定性 PRNG（mulberry32）
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 指数级但对 n<=10 足够快的暴力最大匹配
function bruteMaxMatching(n, adj) {
  const used = new Array(n).fill(false);
  let best = 0;
  function bt(v, count) {
    if (count + Math.floor((n - v) / 2) <= best) return; // 上界剪枝
    if (v >= n) {
      best = Math.max(best, count);
      return;
    }
    if (used[v]) {
      bt(v + 1, count);
      return;
    }
    bt(v + 1, count); // 不匹配 v
    for (let u = v + 1; u < n; u++) {
      if (!used[u] && adj[v].has(u)) {
        used[v] = used[u] = true;
        bt(v + 1, count + 1);
        used[v] = used[u] = false;
      }
    }
  }
  bt(0, 0);
  return best;
}

test('随机一般图：Edmonds 结果与暴力枚举完全一致（成功/失败均覆盖）', () => {
  const rand = mulberry32(20261004);
  let okCount = 0;
  let failCount = 0;
  for (let trial = 0; trial < 400; trial++) {
    const n = 4 + Math.floor(rand() * 7); // 4..10
    const even = n % 2 === 0;
    const channels = Array.from({ length: n }, (_, i) => `V${i}`);
    const edges = [];
    const adj = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (rand() < 0.32) {
          adj[i].add(j);
          adj[j].add(i);
          edges.push([channels[i], channels[j]]);
        }
      }
    }
    const brute = bruteMaxMatching(n, adj);
    const result = run({ channels, edges });

    if (!even || edges.length === 0) {
      // 奇数顶点 / 空边图：被测实现按非法输入拒绝
      assert.ok(['invalid'].includes(result.status));
      continue;
    }
    if (brute * 2 === n) {
      okCount += 1;
      assertPerfect(result, channels);
    } else {
      failCount += 1;
      assert.equal(result.status, 'no-perfect',
        `trial ${trial}：暴力判定无完美匹配但实现称成功`);
      assert.equal(result.matchedVertices, brute * 2,
        `trial ${trial}：最大匹配覆盖数不符（暴力 ${brute * 2}）`);
      independentlyVerifyCertificate({ channels, edges }, result.certificate);
    }
  }
  assert.ok(okCount > 20, `成功样本过少：${okCount}`);
  assert.ok(failCount > 20, `失败样本过少：${failCount}`);
});

test('48 顶点随机稀疏图：性能与有效性', () => {
  const rand = mulberry32(424242);
  const n = 48;
  const channels = Array.from({ length: n }, (_, i) => `CH-${String(i).padStart(2, '0')}`);
  const edges = [];
  const edgeSeen = new Set();
  for (let i = 0; i < n; i += 2) {
    // 保证存在一条已知完美匹配
    edges.push([channels[i], channels[i + 1]]);
    edgeSeen.add(i * n + (i + 1));
  }
  for (let k = 0; k < 120; k++) {
    const i = Math.floor(rand() * n);
    const j = Math.floor(rand() * n);
    if (i === j) continue;
    const key = Math.min(i, j) * n + Math.max(i, j);
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push([channels[Math.min(i, j)], channels[Math.max(i, j)]]);
  }
  const started = Date.now();
  const r = run({ channels, edges });
  assert.equal(r.status, 'ok');
  assert.equal(r.pairs.length, n / 2);
  assertPerfect(r, channels);
  assert.ok(Date.now() - started < 2000, '48 顶点应在 2s 内完成');
});
