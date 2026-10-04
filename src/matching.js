'use strict';

/**
 * 一般无向图的 Edmonds 缩花（blossom）完美匹配，
 * 并在不存在完美匹配时给出 Tutte-Berge 失败证书。
 *
 * 同构模块：Node 下 require（测试 / 服务端），
 * 浏览器 Web Worker 下 importScripts 加载。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  /**
   * 在 n 个顶点的一般无向图中求解完美匹配。
   *
   * @param {number} n 顶点数（须为偶数）
   * @param {Array<[number, number]>} edges 无向边（下标 0..n-1，重复边无害）
   * @returns {{matched: boolean, matching: Array<[number,number]>|null,
   *            certificate: {removed: number[], oddComponents: number[][]}|null}}
   */
  function perfectMatching(n, edges) {
    if (!Number.isInteger(n) || n < 0) throw new Error('顶点数非法');
    const adj = Array.from({ length: n }, () => []);
    for (const [u, v] of edges) {
      if (u === v) continue; // 自环不参与匹配（输入解析阶段已拒绝）
      adj[u].push(v);
      adj[v].push(u);
    }

    const match = new Array(n).fill(-1);

    // 逐个暴露顶点尝试增广（经典 Edmonds O(V^3) 主循环）
    for (let s = 0; s < n; s++) {
      if (match[s] !== -1) continue;
      const forest = growForest(adj, match, [s]);
      if (forest.freeEndpoint !== -1) {
        augment(match, forest.p, forest.freeEndpoint);
      }
    }

    for (let i = 0; i < n; i++) {
      if (match[i] === -1) {
        return { matched: false, matching: null, certificate: barrierCertificate(adj, match) };
      }
    }

    const pairs = [];
    for (let i = 0; i < n; i++) if (i < match[i]) pairs.push([i, match[i]]);
    return { matched: true, matching: pairs, certificate: null };
  }

  /**
   * 沿交错森林父指针翻转匹配边，完成增广。
   */
  function augment(match, p, endpoint) {
    let d = endpoint;
    while (d !== -1) {
      const x = p[d];                         // d 在森林中的父顶点（经由非匹配边）
      const next = x === -1 ? -1 : match[x]; // 翻转前 x 的配偶（下一段）
      match[d] = x;
      if (x !== -1) match[x] = d;
      d = next;
    }
  }

  /**
   * 以 roots（均为暴露顶点）为根生长匈牙利交错森林。
   * 忠实移植 cp-algorithms 的 Edmonds blossom O(V^3) 参考实现，
   * 另维护 reached[] 记录森林到达（含奇层）顶点，供失败证书使用。
   *
   * 关键语义（与 cp 一致）：
   *  - used[v]  仅标记偶层（外层）顶点 / BFS 队列成员；
   *    奇层顶点 p[v]!=-1 但 used[v]==false；
   *  - 缩花后整朵花视为偶层，花内原奇层顶点以 !used 身份重新入队，
   *    这是发现增广路不可省略的一步；
   *  - reached[v] 独立记录“被森林到达”（无论层级）。
   *
   * 返回 p / base / used / reached / freeEndpoint。
   */
  function growForest(adj, match, roots) {
    const n = adj.length;
    const p = new Array(n).fill(-1);
    const base = Array.from({ length: n }, (_, i) => i);
    const used = new Array(n).fill(false);    // 偶层（外层）/ 队列
    const reached = new Array(n).fill(false); // 森林到达（含奇层）
    const blossom = new Array(n).fill(false);
    const isRoot = new Array(n).fill(false);
    const queue = [];

    const findBase = (v) => {
      let x = v;
      while (base[x] !== x) x = base[x];
      return x;
    };

    for (const r of roots) {
      if (!used[r]) {
        used[r] = true;
        reached[r] = true;
        isRoot[r] = true;
        queue.push(r);
      }
    }

    const lca = (a, b) => {
      const seen = new Array(n).fill(false);
      let x = a;
      for (;;) {
        x = findBase(x);
        seen[x] = true;
        if (match[x] === -1) break;            // 走到某棵树的根
        if (p[match[x]] === -1) break;
        x = p[match[x]];
      }
      let y = b;
      for (;;) {
        y = findBase(y);
        if (seen[y]) return y;
        if (match[y] === -1 || p[match[y]] === -1) return -1; // 分属两棵树
        y = p[match[y]];
      }
    };

    const markPath = (v, b, children) => {
      while (findBase(v) !== b) {
        blossom[findBase(v)] = true;
        blossom[findBase(match[v])] = true;
        p[v] = children;
        children = match[v];
        v = p[match[v]];
      }
    };

    let freeEndpoint = -1;

    for (let head = 0; head < queue.length && freeEndpoint === -1; head++) {
      const v = queue[head];
      for (const uRaw of adj[v]) {
        const u = uRaw;
        if (findBase(v) === findBase(u)) continue; // 同一朵收缩花内部
        if (match[v] === u) continue;               // 来路匹配边
        // u 为偶层顶点（暴露根，或其配偶在森林中有父指针）→ 发现奇环，缩花
        const uIsOuter = isRoot[u] || (match[u] !== -1 && p[match[u]] !== -1);
        if (uIsOuter) {
          const curBase = lca(findBase(v), findBase(u));
          if (curBase === -1) continue; // 跨树边：最大匹配下不出现，防御性跳过
          blossom.fill(false);
          markPath(v, curBase, u);
          markPath(u, curBase, v);
          for (let i = 0; i < n; i++) {
            if (blossom[findBase(i)]) {
              base[i] = curBase;
              reached[i] = true;
              if (!used[i]) {
                // 花整体升为偶层：原奇层顶点必须重新入队扩展
                used[i] = true;
                queue.push(i);
              }
            }
          }
        } else if (p[u] === -1) {
          // v(偶) —非匹配边→ u(奇) —匹配边→ match[u](偶)
          p[u] = v;
          reached[u] = true;
          if (match[u] === -1) {
            freeEndpoint = u; // 抵达非根暴露顶点：得到增广路
            break;
          }
          const w = match[u];
          if (!used[w]) {
            used[w] = true;
            reached[w] = true;
            queue.push(w);
          }
        }
      }
    }

    return { p, base, used, reached, freeEndpoint };
  }

  /**
   * 匹配已最大时，以全部暴露顶点为根重跑多源森林生长，构造 Tutte 屏障：
   *   S = 奇层顶点（reached 但非 used/偶层）；
   *   G-S 的每个奇连通分量恰含一个暴露根，因此
   *   odd(G-S) = 暴露顶点数 = |S| + 缺额 > |S|。
   * 连通分量直接在原图删除 S 上 BFS 得到，与匹配过程无关、逐项可核对。
   */
  function barrierCertificate(adj, match) {
    const n = adj.length;
    const roots = [];
    for (let i = 0; i < n; i++) if (match[i] === -1) roots.push(i);
    const forest = growForest(adj, match, roots);

    const removed = [];
    const inS = new Array(n).fill(false);
    for (let v = 0; v < n; v++) {
      if (forest.reached[v] && !forest.used[v]) {
        inS[v] = true;
        removed.push(v);
      }
    }
    removed.sort((a, b) => a - b);

    const seen = new Array(n).fill(false);
    const oddComponents = [];
    for (let start = 0; start < n; start++) {
      if (seen[start] || inS[start]) continue;
      const comp = [];
      const stack = [start];
      seen[start] = true;
      while (stack.length) {
        const x = stack.pop();
        comp.push(x);
        for (const y of adj[x]) {
          if (!seen[y] && !inS[y]) {
            seen[y] = true;
            stack.push(y);
          }
        }
      }
      if (comp.length % 2 === 1) {
        comp.sort((a, b) => a - b);
        oddComponents.push(comp);
      }
    }
    oddComponents.sort((a, b) =>
      a.length !== b.length ? a.length - b.length : a[0] - b[0]
    );

    return { removed, oddComponents };
  }

  return { perfectMatching, growForest };
});
