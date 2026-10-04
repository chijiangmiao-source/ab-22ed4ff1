'use strict';

/**
 * Web Worker 入口：所有匹配计算（Edmonds 缩花 / Tutte 证书）均在此线程执行，
 * 页面主线程只负责收发消息与渲染，绝不参与图算法。
 */
/* global importScripts, perfectMatching, parseInput, presentPairs, verifyCertificate */
importScripts('matching.js', 'parse.js');

self.onmessage = function (event) {
  const { seq, channelsText, edgesText } = event.data || {};
  const started = (self.performance && self.performance.now()) ? self.performance.now() : Date.now();

  try {
    const parsed = parseInput(channelsText, edgesText);
    if (parsed.errors.length > 0) {
      self.postMessage({ seq, type: 'invalid', errors: parsed.errors });
      return;
    }

    const { channels, edges } = parsed;
    const result = perfectMatching(channels.length, edges);
    const elapsed = ((self.performance && self.performance.now()) ? self.performance.now() : Date.now()) - started;

    if (result.matched) {
      self.postMessage({
        seq,
        type: 'matched',
        channels,
        pairs: presentPairs(channels, result.matching),
        elapsed,
      });
      return;
    }

    const cert = result.certificate;
    // 在 Worker 内以原图为唯一依据独立复核证书，逐项随结果返回页面展示
    const checks = verifyCertificate(channels.length, edges, cert.removed, cert.oddComponents);
    self.postMessage({
      seq,
      type: 'unmatched',
      channels,
      elapsed,
      certificate: {
        removed: cert.removed.map((i) => channels[i]),
        oddComponents: cert.oddComponents.map((comp) => comp.map((i) => channels[i])),
        checks,
      },
    });
  } catch (err) {
    self.postMessage({ seq, type: 'error', errors: ['Worker 内部错误：' + (err && err.message ? err.message : String(err))] });
  }
};
