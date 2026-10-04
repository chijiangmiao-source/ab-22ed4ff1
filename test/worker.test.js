// Worker 执行测试：通过 worker_threads 实际加载 src/worker.js，
// 验证匹配规则确实在 Worker 中运行，而非主线程直接计算。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'worker.js',
);

function solveInWorker(channelText, edgeText) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker 响应超时'));
    }, 5000);
    worker.on('message', (msg) => {
      clearTimeout(timer);
      worker.terminate();
      if (msg.type === 'result') resolve(msg);
      else reject(new Error(`意外消息：${JSON.stringify(msg)}`));
    });
    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.postMessage({ type: 'solve', id: 1, channelText, edgeText });
  });
}

test('Worker 实际执行：含奇环图返回完美匹配且按标识排序', async () => {
  const channels = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'];
  const edges = [
    'C01 C02', 'C01 C03', 'C02 C03',
    'C03 C04', 'C04 C05', 'C04 C06', 'C05 C06',
  ].join('\n');
  const msg = await solveInWorker(channels.join('\n'), edges);
  assert.equal(msg.type, 'result');
  assert.equal(msg.result.status, 'ok');
  assert.equal(msg.result.pairs.length, 3);
  assert.deepEqual(msg.result.pairs.flat().sort(), [...channels].sort());
  // 稳定排序
  const firsts = msg.result.pairs.map((p) => p[0]);
  assert.deepEqual(firsts, [...firsts].sort());
});

test('Worker 实际执行：无法配对时返回可核对的 Tutte 证书', async () => {
  const channels = ['HUB', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1'];
  const edges = [
    'HUB A1', 'HUB B1', 'HUB C1',
    'A1 A2', 'A2 A3', 'A3 A1',
    'B1 B2', 'B2 B3', 'B3 B1',
  ].join('\n');
  const msg = await solveInWorker(channels.join('\n'), edges);
  assert.equal(msg.result.status, 'no-perfect');
  assert.equal(msg.result.certificate.sSize, 1);
  assert.equal(msg.result.certificate.oddComponentCount, 3);
  assert.ok(msg.result.certificate.oddComponentCount > msg.result.certificate.sSize);
});

test('Worker 实际执行：非法输入返回 invalid 反馈', async () => {
  const msg = await solveInWorker('a\nb\nc', 'a a');
  assert.equal(msg.result.status, 'invalid');
  assert.ok(msg.result.errors.some((e) => e.code === 'ODD_CHANNEL_COUNT'));
  assert.ok(msg.result.errors.some((e) => e.code === 'SELF_LOOP'));
});

test('Worker 忽略非 solve 消息', async () => {
  const worker = new Worker(workerPath);
  let got = false;
  worker.on('message', () => { got = true; });
  worker.postMessage({ type: 'ping' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(got, false);
  await worker.terminate();
});
