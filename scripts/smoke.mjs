// HTTP 冒烟：启动一次性服务器，验证健康响应、静态资源与 /api/match 的
// 成功 / 失败证书 / 非法输入三类行为，全部通过后以退出码 0 结束；任何失败非 0。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
      lastErr = new Error(`healthz 状态码 ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`服务器未在 ${timeoutMs}ms 内就绪：${lastErr?.message ?? lastErr}`);
}

async function postMatch(baseUrl, channels, edges) {
  const res = await fetch(`${baseUrl}/api/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channels: channels.join('\n'), edges: edges.join('\n') }),
  });
  return { status: res.status, body: await res.json() };
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  const port = Number(process.env.PORT) || (await pickFreePort());
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[smoke] 启动一次性服务器：${baseUrl}`);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  let exitInfo = null;
  server.on('exit', (code, signal) => { exitInfo = { code, signal }; });

  try {
    await waitForHealth(baseUrl);

    console.log('[smoke] 1) 健康响应');
    const health = await fetch(`${baseUrl}/healthz`);
    const healthBody = await health.json();
    check('GET /healthz 返回 200', health.status === 200);
    check('健康体 status=ok', healthBody.status === 'ok');

    console.log('[smoke] 2) 页面静态资源');
    for (const asset of ['/', '/index.html', '/styles.css', '/app.js', '/worker.js', '/matching.js']) {
      const res = await fetch(baseUrl + asset);
      const text = await res.text();
      check(`GET ${asset} 返回 200`, res.status === 200, `实际 ${res.status}`);
      if (asset.endsWith('.js')) check(`${asset} 非空`, text.length > 50);
      if (asset === '/worker.js') check('worker.js 确实引入匹配模块', text.includes('matching.js'));
      if (asset === '/index.html') {
        check('页面以 module 方式加载 app.js', text.includes('type="module"') && text.includes('app.js'));
      }
    }
    const manifest = await fetch(`${baseUrl}/build-manifest.json`);
    check('构建清单存在', manifest.status === 200);

    console.log('[smoke] 3) 题目输入：含奇环可配对');
    const okInput = {
      channels: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'],
      edges: [
        'C01 C02', 'C01 C03', 'C02 C03',
        'C03 C04', 'C04 C05', 'C04 C06', 'C05 C06',
      ],
    };
    const okRes = await postMatch(baseUrl, okInput.channels, okInput.edges);
    check('状态 200', okRes.status === 200);
    check('status=ok', okRes.body.status === 'ok', JSON.stringify(okRes.body).slice(0, 200));
    check('3 对配对覆盖 6 通道', okRes.body.pairs?.length === 3);
    check(
      '按标识稳定排序',
      JSON.stringify(okRes.body.pairs) === JSON.stringify([...okRes.body.pairs].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)),
      JSON.stringify(okRes.body.pairs),
    );

    console.log('[smoke] 4) 题目输入：孤立通道阻塞完整配对');
    const failInput = {
      channels: ['HUB', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1'],
      edges: [
        'HUB A1', 'HUB B1', 'HUB C1',
        'A1 A2', 'A2 A3', 'A3 A1',
        'B1 B2', 'B2 B3', 'B3 B1',
      ],
    };
    const failRes = await postMatch(baseUrl, failInput.channels, failInput.edges);
    check('status=no-perfect', failRes.body.status === 'no-perfect');
    const cert = failRes.body.certificate;
    check('|S|=1', cert?.sSize === 1, JSON.stringify(cert)?.slice(0, 200));
    check('奇分量数=3', cert?.oddComponentCount === 3);
    check('严格不等式 q(S) > |S|', cert?.oddComponentCount > cert?.sSize);
    check('S = [HUB]', JSON.stringify(cert?.s) === JSON.stringify(['HUB']));

    // 用证书数据现场核对：每个奇分量确实奇、跨边都在提交的原图中
    const edgeSet = new Set(failInput.edges.map((e) => {
      const [a, b] = e.split(' ');
      return a < b ? `${a}⇄${b}` : `${b}⇄${a}`;
    }));
    let crossOk = true;
    for (const comp of cert.oddComponents) {
      if (comp.size % 2 !== 1 || comp.size !== comp.vertices.length) crossOk = false;
      for (const [a, b] of comp.edgesToS) {
        const key = a < b ? `${a}⇄${b}` : `${b}⇄${a}`;
        if (!edgeSet.has(key)) crossOk = false;
      }
    }
    check('证书每条跨边均可在提交的原图中核对', crossOk);

    console.log('[smoke] 5) 非法输入（自环 + 奇数通道）给出明确反馈');
    const badRes = await postMatch(baseUrl, ['a', 'b', 'c'], ['a a']);
    check('status=invalid', badRes.body.status === 'invalid');
    check('报自环', badRes.body.errors?.some((e) => e.code === 'SELF_LOOP'));
    check('报奇数通道', badRes.body.errors?.some((e) => e.code === 'ODD_CHANNEL_COUNT'));

    console.log('[smoke] 6) 其他非法输入类型');
    const dupEdge = await postMatch(
      baseUrl,
      ['a', 'b', 'c', 'd'],
      ['a b', 'b a', 'c d'],
    );
    check('重复边被拒绝', dupEdge.body.errors?.some((e) => e.code === 'DUPLICATE_EDGE'));

    const unknown = await postMatch(baseUrl, ['a', 'b', 'c', 'd'], ['a x', 'c d']);
    check('未知端点被拒绝', unknown.body.errors?.some((e) => e.code === 'UNKNOWN_ENDPOINT'));

    const emptyGraph = await postMatch(baseUrl, ['a', 'b', 'c', 'd'], []);
    check('空边图被拒绝', emptyGraph.body.errors?.some((e) => e.code === 'EMPTY_EDGE_GRAPH'));

    console.log('[smoke] 7) 基础防护');
    const notFound = await fetch(`${baseUrl}/../server.mjs`);
    check('路径穿越不泄漏源码', notFound.status === 404);
    const getApi = await fetch(`${baseUrl}/api/match`);
    check('GET /api/match 返回 405', getApi.status === 405);
  } catch (err) {
    failures += 1;
    console.error('[smoke] 异常：', err);
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => {
      if (exitInfo) return r();
      server.on('exit', r);
      setTimeout(r, 2000).unref();
    });
    if (!serverLog.includes('listening on') && exitInfo?.code !== 0) {
      console.error('[smoke] 服务器日志：\n' + serverLog);
    }
  }

  if (failures > 0) {
    console.error(`[smoke] 失败 ${failures} 项`);
    process.exit(1);
  }
  console.log('[smoke] 全部通过');
  process.exit(0);
}

main();
