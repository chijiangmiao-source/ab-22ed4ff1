// 一般图（非二分图）完美匹配核心：
//   - Edmonds 缩花（blossom）最大匹配，O(n^3)
//   - 无完美匹配时，基于 Gallai-Edmonds 分解给出 Tutte 失败证书：
//     移除集合 S 与 G-S 的奇数连通分量，奇数分量数严格大于 |S|
//
// 纯函数模块，可同时被 Web Worker、Node 测试与 HTTP 接口复用。

const MIN_CHANNELS = 3;
const MAX_CHANNELS = 48;

/**
 * 解析原始文本。
 * 通道：每行一个标识；边：每行两个标识，分隔符可为空白 / "--" / "," / "，"。
 * @returns {{channels:string[], edges:[string,string][], lineErrors:Array<{line:number,message:string}>}}
 */
export function parseInput(channelText, edgeText) {
  const channels = [];
  for (const raw of String(channelText ?? '').split(/\r?\n/)) {
    const id = raw.trim();
    if (id !== '') channels.push(id);
  }

  const edges = [];
  const lineErrors = [];
  const lines = String(edgeText ?? '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line === '') return;
    const tokens = line
      .split(/--+|,|，|\s+/)
      .map((t) => t.trim())
      .filter((t) => t !== '');
    if (tokens.length !== 2) {
      lineErrors.push({
        line: idx + 1,
        message: `第 ${idx + 1} 行无法解析为一条兼容边："${line}"（需要恰好两个通道标识）`,
      });
      return;
    }
    edges.push([tokens[0], tokens[1]]);
  });

  return { channels, edges, lineErrors };
}

/**
 * 输入校验。错误全部收集后一次性返回，便于页面明确反馈。
 * 校验项：通道数量 3..48、偶数、唯一；边不得自环 / 重复 / 含未知端点；不得为空边图。
 */
export function validateInput(channels, edges) {
  const errors = [];

  const seenChannel = new Set();
  const duplicateChannels = [];
  for (const id of channels) {
    if (seenChannel.has(id) && !duplicateChannels.includes(id)) duplicateChannels.push(id);
    seenChannel.add(id);
  }
  if (duplicateChannels.length > 0) {
    errors.push({
      code: 'DUPLICATE_CHANNEL',
      message: `通道标识重复：${duplicateChannels.join('、')}`,
    });
  }

  const n = channels.length;
  if (n < MIN_CHANNELS) {
    errors.push({
      code: 'TOO_FEW_CHANNELS',
      message: `通道数量为 ${n}，至少需要 ${MIN_CHANNELS} 个通道。`,
    });
  }
  if (n > MAX_CHANNELS) {
    errors.push({
      code: 'TOO_MANY_CHANNELS',
      message: `通道数量为 ${n}，最多允许 ${MAX_CHANNELS} 个通道。`,
    });
  }
  if (n >= MIN_CHANNELS && n <= MAX_CHANNELS && n % 2 !== 0) {
    errors.push({
      code: 'ODD_CHANNEL_COUNT',
      message: `通道数量为 ${n}（奇数），完整配对要求通道数为偶数。`,
    });
  }

  if (edges.length === 0 && n > 0) {
    errors.push({
      code: 'EMPTY_EDGE_GRAPH',
      message: '空边图：未录入任何兼容边，所有通道彼此不兼容，无法配对。',
    });
  }

  const selfLoops = [];
  const unknownEndpoints = [];
  const edgeKey = new Set();
  const duplicateEdges = [];
  for (const [a, b] of edges) {
    if (a === b) {
      selfLoops.push(a);
      continue;
    }
    if (!seenChannel.has(a) || !seenChannel.has(b)) {
      const missing = [!seenChannel.has(a) ? a : null, !seenChannel.has(b) ? b : null]
        .filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i);
      unknownEndpoints.push(...missing.map((m) => `${m}（边 ${a} -- ${b}）`));
      continue;
    }
    const key = a < b ? `${a}⇄${b}` : `${b}⇄${a}`;
    if (edgeKey.has(key)) {
      duplicateEdges.push(`${a} -- ${b}`);
    } else {
      edgeKey.add(key);
    }
  }

  if (selfLoops.length > 0) {
    errors.push({
      code: 'SELF_LOOP',
      message: `兼容边不能是自环：${selfLoops.join('、')}`,
    });
  }
  if (unknownEndpoints.length > 0) {
    errors.push({
      code: 'UNKNOWN_ENDPOINT',
      message: `兼容边包含通道清单之外的未知端点：${unknownEndpoints.join('、')}`,
    });
  }
  if (duplicateEdges.length > 0) {
    errors.push({
      code: 'DUPLICATE_EDGE',
      message: `兼容边重复录入：${duplicateEdges.join('、')}`,
    });
  }

  return errors;
}

/**
 * Edmonds 缩花算法：返回最大匹配（match[i] 为 i 的配对下标，未匹配为 -1）。
 * 逐轮从未匹配点出发做缩花 BFS，找到增广路即增广。
 */
function maximumMatching(n, adj) {
  const match = new Array(n).fill(-1);

  const findPath = (root) => {
    const p = new Array(n).fill(-1); // BFS 父母（交替树）
    const base = Array.from({ length: n }, (_, i) => i); // 缩花后的代表点
    const used = new Array(n).fill(false); // 入队点 = 交替树的偶数层点
    const blossom = new Array(n).fill(false);
    const queue = [root];
    used[root] = true;

    const lca = (a, b) => {
      const seen = new Array(n).fill(false);
      for (;;) {
        a = base[a];
        seen[a] = true;
        if (match[a] === -1) break;
        a = p[match[a]];
      }
      for (;;) {
        b = base[b];
        if (seen[b]) return b;
        b = p[match[b]];
      }
    };

    const markPath = (v, b, child) => {
      while (base[v] !== b) {
        blossom[base[v]] = true;
        blossom[base[match[v]]] = true;
        p[v] = child;
        child = match[v];
        v = p[match[v]];
      }
    };

    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (const to of adj[v]) {
        if (base[v] === base[to] || match[v] === to) continue;
        // 两个偶数层点之间的非匹配边：发现奇花，缩花
        if (to === root || (match[to] !== -1 && p[match[to]] !== -1)) {
          const cb = lca(v, to);
          blossom.fill(false);
          markPath(v, cb, to);
          markPath(to, cb, v);
          for (let i = 0; i < n; i++) {
            if (blossom[base[i]]) {
              base[i] = cb;
              if (!used[i]) {
                used[i] = true;
                queue.push(i);
              }
            }
          }
        } else if (p[to] === -1) {
          p[to] = v;
          if (match[to] === -1) return { end: to, p }; // 增广路终点
          const w = match[to];
          used[w] = true;
          queue.push(w);
        }
      }
    }
    return { end: -1, p };
  };

  for (let s = 0; s < n; s++) {
    if (match[s] !== -1) continue;
    const { end, p } = findPath(s);
    if (end === -1) continue;
    // 沿父母指针增广
    let t = end;
    while (t !== -1) {
      const v = p[t];
      const pv = match[v];
      match[t] = v;
      match[v] = t;
      t = pv;
    }
  }
  return match;
}

/**
 * 在最大匹配上做多源缩花交替 BFS，取 Gallai-Edmonds 的 D 集
 * （可由未匹配点经偶长交替路到达的点）。
 */
function alternatingEvenSet(n, adj, match, roots) {
  const p = new Array(n).fill(-1);
  const base = Array.from({ length: n }, (_, i) => i);
  const used = new Array(n).fill(false);
  const isRoot = new Array(n).fill(false);
  const blossom = new Array(n).fill(false);
  const queue = [];
  for (const r of roots) {
    if (!used[r]) {
      used[r] = true;
      isRoot[r] = true;
      queue.push(r);
    }
  }

  const lca = (a, b) => {
    const seen = new Array(n).fill(false);
    let guard = 0;
    for (;;) {
      a = base[a];
      seen[a] = true;
      if (match[a] === -1) break;
      a = p[match[a]];
      if (++guard > 2 * n + 4) throw new Error('缩花 LCA 遍历异常');
    }
    guard = 0;
    for (;;) {
      b = base[b];
      if (seen[b]) return b;
      b = p[match[b]];
      if (++guard > 2 * n + 4) throw new Error('缩花 LCA 遍历异常');
    }
  };

  const markPath = (v, b, child) => {
    while (base[v] !== b) {
      blossom[base[v]] = true;
      blossom[base[match[v]]] = true;
      p[v] = child;
      child = match[v];
      v = p[match[v]];
    }
  };

  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const to of adj[v]) {
      if (base[v] === base[to] || match[v] === to) continue;
      if (isRoot[to] || (match[to] !== -1 && p[match[to]] !== -1)) {
        const cb = lca(v, to);
        blossom.fill(false);
        markPath(v, cb, to);
        markPath(to, cb, v);
        for (let i = 0; i < n; i++) {
          if (blossom[base[i]]) {
            base[i] = cb;
            if (!used[i]) {
              used[i] = true;
              queue.push(i);
            }
          }
        }
      } else if (p[to] === -1) {
        // 最大匹配下，未标记点必已匹配；否则意味着存在增广路（不应发生）
        if (match[to] === -1) {
          throw new Error('最大匹配校验失败：仍存在增广路');
        }
        p[to] = v;
        const w = match[to];
        used[w] = true;
        queue.push(w);
      }
    }
  }
  return used;
}

/**
 * 独立地按原图计算 G-S 的连通分量（不依赖匹配过程的任何中间状态），
 * 使失败证书可由原图逐项核对。
 */
function componentsAfterRemoval(n, adj, removed) {
  const seen = new Array(n).fill(false);
  const components = [];
  for (let start = 0; start < n; start++) {
    if (removed[start] || seen[start]) continue;
    const vertices = [];
    const stack = [start];
    seen[start] = true;
    while (stack.length > 0) {
      const v = stack.pop();
      vertices.push(v);
      for (const u of adj[v]) {
        if (!removed[u] && !seen[u]) {
          seen[u] = true;
          stack.push(u);
        }
      }
    }
    components.push(vertices);
  }
  return components;
}

/**
 * 求 Tutte 失败证书。返回移除集合 S（按标识排序）与 G-S 的全部奇数连通分量。
 */
function tutteCertificate(n, adj, match, ids) {
  const exposed = [];
  for (let i = 0; i < n; i++) if (match[i] === -1) exposed.push(i);

  const inD = alternatingEvenSet(n, adj, match, exposed);

  // S = A = D 在 D 外的邻点集
  const inS = new Array(n).fill(false);
  for (let v = 0; v < n; v++) {
    if (inD[v]) continue;
    for (const u of adj[v]) {
      if (inD[u]) {
        inS[v] = true;
        break;
      }
    }
  }

  const components = componentsAfterRemoval(n, adj, inS);
  const oddComponents = components
    .filter((comp) => comp.length % 2 === 1)
    .map((comp) => {
      const vertices = comp.map((i) => ids[i]).sort();
      const crossingEdges = [];
      for (const i of comp) {
        for (const j of adj[i]) {
          if (inS[j]) {
            const a = ids[i];
            const b = ids[j];
            crossingEdges.push(a < b ? [a, b] : [b, a]);
          }
        }
      }
      crossingEdges.sort((p1, p2) => byIdAsc(p1[0], p2[0]) || byIdAsc(p1[1], p2[1]));
      return {
        size: comp.length,
        vertices,
        // 证书中的每条边都可在原图中逐项核对
        edgesToS: crossingEdges,
      };
    })
    .sort((a, b) => (a.vertices[0] < b.vertices[0] ? -1 : a.vertices[0] > b.vertices[0] ? 1 : 0));

  const s = ids.filter((_, i) => inS[i]).sort();

  // 证书自检：奇数分量数必须严格大于移除集合大小（Tutte 定理）
  if (!(oddComponents.length > s.length)) {
    throw new Error(
      `失败证书自检失败：奇数连通分量 ${oddComponents.length} 个，移除集合 ${s.length} 个，不满足严格大于`,
    );
  }

  return {
    s,
    sSize: s.length,
    oddComponents,
    oddComponentCount: oddComponents.length,
  };
}

function byIdAsc(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 求解入口。返回：
 *   { status:'ok', pairs:[[id,id],...] }
 *   { status:'no-perfect', certificate:{...} }
 *   { status:'invalid', errors:[{code,message}] }
 */
export function solveText(channelText, edgeText) {
  const { channels, edges, lineErrors } = parseInput(channelText, edgeText);
  const errors = [...lineErrors, ...validateInput(channels, edges)];
  if (errors.length > 0) return { status: 'invalid', errors };

  const idToIndex = new Map(channels.map((id, i) => [id, i]));
  const n = channels.length;
  const adj = Array.from({ length: n }, () => new Set());
  for (const [a, b] of edges) {
    const i = idToIndex.get(a);
    const j = idToIndex.get(b);
    adj[i].add(j);
    adj[j].add(i);
  }
  const adjSorted = adj.map((set) => [...set].sort((x, y) => x - y));

  const match = maximumMatching(n, adjSorted);

  if (match.every((v) => v !== -1)) {
    const pairs = [];
    for (let i = 0; i < n; i++) {
      if (i < match[i]) {
        const a = channels[i];
        const b = channels[match[i]];
        pairs.push([a < b ? a : b, a < b ? b : a]);
      }
    }
    pairs.sort((p1, p2) => byIdAsc(p1[0], p2[0]) || byIdAsc(p1[1], p2[1]));
    return { status: 'ok', pairs, vertexCount: n };
  }

  const certificate = tutteCertificate(n, adjSorted, match, channels);
  return { status: 'no-perfect', certificate, vertexCount: n, matchedVertices: match.filter((v) => v !== -1).length };
}
