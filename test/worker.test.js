'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** 在模拟的浏览器 Worker 全局环境中加载 worker.js 及其 importScripts 依赖 */
function loadWorker() {
  const messages = [];
  const sandbox = {
    console,
    performance: { now: () => 0 },
    Date,
    postMessage(msg) {
      messages.push(msg);
    },
  };
  sandbox.self = sandbox;
  sandbox.importScripts = (...names) => {
    for (const name of names) {
      const code = fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
      vm.runInContext(code, sandbox, { filename: name });
    }
  };
  vm.createContext(sandbox);
  const workerCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'worker.js'), 'utf8');
  vm.runInContext(workerCode, sandbox, { filename: 'worker.js' });
  return {
    post: (data) => sandbox.self.onmessage({ data }),
    messages,
  };
}

/** vm 上下文产生的数组跨 realm，原型不同，按 JSON 结构比较 */
function sameStruct(actual, expected) {
  return JSON.parse(JSON.stringify(actual));
}

test('Worker：缩花成功输入返回按标识排序的配对', () => {
  const w = loadWorker();
  w.post({
    seq: 1,
    channelsText: 'A1 A2 A3 B1 B2 B3',
    edgesText: 'A1 A2\nA2 A3\nA3 A1\nB1 B2\nB2 B3\nB3 B1\nA1 B1',
  });
  assert.equal(w.messages.length, 1);
  const msg = w.messages[0];
  assert.equal(msg.seq, 1);
  assert.equal(msg.type, 'matched');
  assert.equal(msg.pairs.length, 3);
  assert.deepEqual(sameStruct(msg.pairs), [
    ['A1', 'B1'],
    ['A2', 'A3'],
    ['B2', 'B3'],
  ]);
});

test('Worker：失败输入返回 Tutte 证书且核对项全过', () => {
  const w = loadWorker();
  w.post({ seq: 2, channelsText: 'C0 C1 C2 C3', edgesText: 'C0 C1\nC0 C2\nC0 C3' });
  const msg = w.messages[0];
  assert.equal(msg.type, 'unmatched');
  assert.deepEqual(sameStruct(msg.certificate.removed), ['C0']);
  assert.deepEqual(sameStruct(msg.certificate.oddComponents), [['C1'], ['C2'], ['C3']]);
  assert.ok(msg.certificate.checks.every((c) => c.ok));
});

test('Worker：非法输入（自环+奇数量）回 invalid，不含任何旧配对数据', () => {
  const w = loadWorker();
  w.post({ seq: 3, channelsText: 'A B C', edgesText: 'A A' });
  const msg = w.messages[0];
  assert.equal(msg.type, 'invalid');
  assert.ok(msg.errors.length >= 2);
  assert.ok(msg.errors.some((e) => e.includes('自环')));
  assert.ok(msg.errors.some((e) => e.includes('偶数')));
  assert.equal(msg.pairs, undefined);
  assert.equal(msg.certificate, undefined);
});

test('Worker：空边图被拒绝', () => {
  const w = loadWorker();
  w.post({ seq: 4, channelsText: 'A B C D', edgesText: '' });
  const msg = w.messages[0];
  assert.equal(msg.type, 'invalid');
  assert.ok(msg.errors.some((e) => e.includes('空边图')));
});

test('前端脚本语法检查（app.js / worker.js）', () => {
  for (const f of ['app.js', 'worker.js', 'matching.js', 'parse.js']) {
    execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'src', f)]);
  }
});
