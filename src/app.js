'use strict';

/**
 * 页面主线程：仅负责输入采集、Web Worker 调度与结果渲染。
 * 任何图计算都不允许出现在此文件中。
 */
(function () {
  const channelsEl = document.getElementById('channels');
  const edgesEl = document.getElementById('edges');
  const runBtn = document.getElementById('run');
  const sampleBtn = document.getElementById('sample');
  const sampleBlossomBtn = document.getElementById('sample-blossom');
  const clearBtn = document.getElementById('clear');
  const statusEl = document.getElementById('status');
  const errorsEl = document.getElementById('errors');
  const resultEl = document.getElementById('result');
  const resultHeadEl = document.getElementById('result-head');
  const resultBodyEl = document.getElementById('result-body');

  let seq = 0;
  let worker = null;

  function spawnWorker() {
    if (worker) worker.terminate();
    worker = new Worker('worker.js');
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      showErrors(['匹配 Worker 启动或运行失败：' + (e.message || '未知错误') + '（请通过 HTTP 访问本页面，file:// 下 Worker 不可用）']);
    };
  }

  function onWorkerMessage(event) {
    const data = event.data;
    if (data.seq !== seq) return; // 丢弃过期响应
    runBtn.disabled = false;
    runBtn.textContent = '复核配对';

    if (data.type === 'invalid' || data.type === 'error') {
      // 失败提交：清空上一次通过的配对，绝不保留旧结果
      clearResult();
      showErrors(data.errors);
      setStatus('idle', '');
      return;
    }

    errorsEl.innerHTML = '';
    if (data.type === 'matched') {
      renderMatched(data);
    } else if (data.type === 'unmatched') {
      // 同样清除“配对展示区”，改为展示失败证书
      renderUnmatched(data);
    }
  }

  function renderMatched(data) {
    setStatus('ok', `复核通过：全部 ${data.channels.length} 个通道已两两配对，共 ${data.pairs.length} 对（耗时 ${data.elapsed.toFixed(2)} ms）`);
    resultEl.hidden = false;
    resultHeadEl.innerHTML = '<h2>覆盖全部通道的配对方案</h2>';
    const rows = data.pairs
      .map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p[0])}</td><td>${esc(p[1])}</td></tr>`)
      .join('');
    resultBodyEl.innerHTML =
      `<table class="pairs"><thead><tr><th>#</th><th>通道 A</th><th>通道 B</th></tr></thead><tbody>${rows}</tbody></table>` +
      note('配对已按通道标识升序稳定排序；每一对均为录入的无向兼容边。');
  }

  function renderUnmatched(data) {
    const c = data.certificate;
    setStatus('fail', `无法完整配对：存在 Tutte 阻塞集合（耗时 ${data.elapsed.toFixed(2)} ms）`);
    resultEl.hidden = false;
    resultHeadEl.innerHTML =
      '<h2>阻止完整配对的通道集合（Tutte 证书）</h2>' +
      `<p class="explain">移除下方集合 S 后，原图剩余部分的<strong>奇数连通分量数（${c.oddComponents.length}）` +
      `严格大于移除集合大小（${c.removed.length}）</strong>：每个奇分量至多向 S 内部消化一个通道，` +
      `其余通道必然孤立，因此不存在覆盖全部通道的配对。</p>`;

    const removedHtml = c.removed.length
      ? `<ul class="removed">${c.removed.map((id) => `<li>${esc(id)}</li>`).join('')}</ul>`
      : '<p class="muted">（空集，S = ∅）</p>';

    const compsHtml = c.oddComponents
      .map(
        (comp, i) =>
          `<details class="comp" ${i < 3 ? 'open' : ''}><summary>奇分量 #${i + 1}：${comp.length} 个通道</summary>` +
          `<ul>${comp.map((id) => `<li>${esc(id)}</li>`).join('')}</ul></details>`
      )
      .join('');

    const allChecksOk = c.checks.every((k) => k.ok);
    const checksHtml =
      '<h3>凭原图逐项核对</h3>' +
      '<ul class="checks">' +
      c.checks
        .map((k) => `<li class="${k.ok ? 'ok' : 'bad'}">${k.ok ? '✓' : '✗'} ${esc(k.label)}</li>`)
        .join('') +
      '</ul>' +
      (allChecksOk ? '<p class="verify-ok">证书全部核对项通过，可直接在录入的原图上复验。</p>' : '');

    resultBodyEl.innerHTML =
      `<div class="cert-grid"><div><h3>移除集合 S（${c.removed.length} 个）</h3>${removedHtml}</div>` +
      `<div><h3>移除后的奇数连通分量（${c.oddComponents.length} 个）</h3><div class="comps">${compsHtml}</div></div></div>` +
      checksHtml;
  }

  function showErrors(errors) {
    errorsEl.innerHTML =
      '<div class="error-box"><strong>输入无法复核：</strong><ul>' +
      errors.map((m) => `<li>${esc(m)}</li>`).join('') +
      '</ul></div>';
  }

  function clearResult() {
    resultEl.hidden = true;
    resultHeadEl.innerHTML = '';
    resultBodyEl.innerHTML = '';
  }

  function setStatus(kind, text) {
    statusEl.className = 'status ' + kind;
    statusEl.textContent = text;
  }

  function note(text) {
    return `<p class="muted">${esc(text)}</p>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
    );
  }

  runBtn.addEventListener('click', () => {
    seq++;
    runBtn.disabled = true;
    runBtn.textContent = '复核中…';
    errorsEl.innerHTML = '';
    setStatus('running', '正在 Web Worker 中按一般图语义执行 Edmonds 缩花…');
    spawnWorker();
    worker.postMessage({
      seq,
      channelsText: channelsEl.value,
      edgesText: edgesEl.value,
    });
  });

  clearBtn.addEventListener('click', () => {
    channelsEl.value = '';
    edgesEl.value = '';
    seq++;
    clearResult();
    errorsEl.innerHTML = '';
    setStatus('idle', '');
  });

  sampleBtn.addEventListener('click', () => {
    // 星型 K1,3：4 个通道仅经中心兼容。Tutte 证书 S={中心}，
    // 删除后得到 3 个单点奇分量，3 > 1，无法完整配对。
    channelsEl.value = 'CH-0 CH-1 CH-2 CH-3';
    edgesEl.value = 'CH-0 CH-1\nCH-0 CH-2\nCH-0 CH-3';
  });

  sampleBlossomBtn.addEventListener('click', () => {
    // 含两个奇环（三角花）的一般图：必须真正执行缩花才能找到完美匹配，
    // 二分图语义无法处理此类图。
    channelsEl.value = 'CH-A1 CH-A2 CH-A3 CH-B1 CH-B2 CH-B3';
    edgesEl.value =
      'CH-A1 CH-A2\nCH-A2 CH-A3\nCH-A3 CH-A1\n' +
      'CH-B1 CH-B2\nCH-B2 CH-B3\nCH-B3 CH-B1\n' +
      'CH-A1 CH-B1';
  });

  spawnWorker();
})();
