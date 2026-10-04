'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInput, presentPairs, verifyCertificate } = require('../src/parse');

test('合法输入解析：去空白、索引正确', () => {
  const r = parseInput('A B C D', 'A B\nC D\nA D');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.channels, ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.edges, [[0, 1], [2, 3], [0, 3]]);
});

test('逗号/分号/中文标点均可分隔通道', () => {
  const r = parseInput('A, B，C；D', 'A B\nC D');
  assert.deepEqual(r.errors, []);
  assert.equal(r.channels.length, 4);
});

test('自环被拒绝', () => {
  const r = parseInput('A B C D', 'A A\nB C');
  assert.ok(r.errors.some((e) => e.includes('自环')));
});

test('重复边（含反向书写）被拒绝', () => {
  const r1 = parseInput('A B C D', 'A B\nA B');
  assert.ok(r1.errors.some((e) => e.includes('重复')));
  const r2 = parseInput('A B C D', 'A B\nB A');
  assert.ok(r2.errors.some((e) => e.includes('重复')));
});

test('未知端点被拒绝', () => {
  const r = parseInput('A B C D', 'A X\nY Z');
  assert.ok(r.errors.some((e) => e.includes('未知端点')));
});

test('奇数个通道被拒绝', () => {
  const r = parseInput('A B C', 'A B\nB C');
  assert.ok(r.errors.some((e) => e.includes('偶数')));
});

test('少于 3 个通道被拒绝', () => {
  const r = parseInput('A B', 'A B');
  assert.ok(r.errors.some((e) => e.includes('3–48')));
});

test('空通道清单被拒绝', () => {
  const r = parseInput('', 'A B');
  assert.ok(r.errors.length > 0);
});

test('超过 48 个通道被拒绝', () => {
  const ids = Array.from({ length: 49 }, (_, i) => `N${i}`).join(' ');
  const r = parseInput(ids, '');
  assert.ok(r.errors.some((e) => e.includes('3–48')));
});

test('重复通道标识被拒绝', () => {
  const r = parseInput('A B C A', 'A B');
  assert.ok(r.errors.some((e) => e.includes('通道标识重复')));
});

test('空边图被拒绝', () => {
  const r = parseInput('A B C D', '');
  assert.ok(r.errors.some((e) => e.includes('空边图')));
});

test('边行端点数量错误被拒绝', () => {
  const r = parseInput('A B C D', 'A B C');
  assert.ok(r.errors.some((e) => e.includes('每行须恰好两个')));
});

test('中文通道标识可接受', () => {
  const r = parseInput('通道甲 通道乙 通道丙 通道丁', '通道甲 通道乙\n通道丙 通道丁');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.channels, ['通道甲', '通道乙', '通道丙', '通道丁']);
});

test('presentPairs：对内排序 + 按标识稳定排序', () => {
  const pairs = presentPairs(['B', 'A', 'D', 'C'], [[2, 3], [1, 0]]);
  assert.deepEqual(pairs, [['A', 'B'], ['C', 'D']]);
});

test('verifyCertificate：合法 K1,3 证书全部核对通过', () => {
  const edges = [[0, 1], [0, 2], [0, 3]];
  const checks = verifyCertificate(4, edges, [0], [[1], [2], [3]]);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
});

test('verifyCertificate：伪造证书（跨分量原图边）被识破', () => {
  // 实际图是 4 环 0-1-2-3-0，声称 S=∅ 分量为 {0,1} 与 {2,3}（都是偶数，且声明非真实划分）
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const checks = verifyCertificate(4, edges, [], [[0, 1], [2, 3]]);
  assert.ok(checks.some((c) => !c.ok));
});

test('verifyCertificate：严格不等式不满足被识破', () => {
  const edges = [[0, 1]];
  const checks = verifyCertificate(2, edges, [0], [[1]]);
  const strict = checks.find((c) => c.label.includes('严格不等式'));
  assert.equal(strict.ok, false);
});
