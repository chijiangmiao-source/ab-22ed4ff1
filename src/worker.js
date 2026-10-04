// Web Worker：所有匹配计算（含 Edmonds 缩花）都在本 Worker 内执行，
// 不阻塞主线程。Node 下通过 worker_threads 复用同一文件（见测试）。
import { solveText } from './matching.js';

let nodePort = null;
try {
  // 浏览器中该裸模块导入会失败并被忽略
  const threads = await import('node:worker_threads');
  nodePort = threads.parentPort;
} catch {
  nodePort = null;
}

function send(message) {
  if (nodePort) nodePort.postMessage(message);
  else self.postMessage(message);
}

function handle(raw) {
  const message = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
  if (!message || message.type !== 'solve') return;
  const started = Date.now();
  try {
    const result = solveText(message.channelText ?? '', message.edgeText ?? '');
    send({ type: 'result', id: message.id, elapsedMs: Date.now() - started, result });
  } catch (err) {
    send({
      type: 'result',
      id: message.id,
      elapsedMs: Date.now() - started,
      result: {
        status: 'error',
        errors: [{ code: 'WORKER_EXCEPTION', message: `Worker 计算异常：${err && err.message ? err.message : String(err)}` }],
      },
    });
  }
}

if (nodePort) {
  nodePort.on('message', handle);
} else {
  self.onmessage = (event) => handle(event.data);
}
