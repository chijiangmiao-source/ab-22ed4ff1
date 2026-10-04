// 主线程：录入、校验反馈、Worker 调度、结果渲染。
const $ = (id) => document.getElementById(id);

const channelsEl = $('channels');
const edgesEl = $('edges');
const checkBtn = $('checkBtn');
const workerStatusEl = $('workerStatus');
const channelCountEl = $('channelCount');

const placeholder = $('placeholder');
const resultBox = $('resultBox');
const summary = $('summary');
const errorsBox = $('errors');
const successView = $('successView');
const failureView = $('failureView');
const pairsBody = $('pairsBody');
const sList = $('sList');
const oddComponentsEl = $('oddComponents');
const sSizeEl = $('sSize');
const oddCountEl = $('oddCount');
const inequalityEl = $('inequality');

let worker = null;
let workerOk = false;
let inflightId = 0;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[ch];
  });
}

function setWorkerStatus(kind, text) {
  workerStatusEl.className = `worker-status ${kind}`;
  workerStatusEl.textContent = text;
}

function createWorker() {
  try {
    worker = new Worker('./worker.js', { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (event) => {
      setWorkerStatus('err', `Worker 运行失败：${event.message}`);
      workerOk = false;
    };
    workerOk = true;
    setWorkerStatus('ok', 'Web Worker 就绪，复核计算在独立线程执行。');
  } catch (err) {
    workerOk = false;
    setWorkerStatus('err', `Web Worker 无法启动：${err.message}`);
  }
}

function onWorkerMessage(event) {
  const msg = event.data;
  if (!msg || msg.type !== 'result' || msg.id !== inflightId) return;
  checkBtn.disabled = false;
  setWorkerStatus('ok', `计算完成，用时 ${msg.elapsedMs} ms。`);
  renderResult(msg.result);
}

function clearResult() {
  // 任何新的提交（尤其失败提交）都不得保留上次通过的配对
  resultBox.hidden = true;
  placeholder.hidden = false;
  summary.className = 'summary';
  summary.textContent = '';
  errorsBox.hidden = true;
  errorsBox.innerHTML = '';
  successView.hidden = true;
  failureView.hidden = true;
  pairsBody.innerHTML = '';
  sList.innerHTML = '';
  oddComponentsEl.innerHTML = '';
}

function renderResult(result) {
  clearResult();
  placeholder.hidden = true;
  resultBox.hidden = false;

  if (result.status === 'invalid') {
    summary.className = 'summary invalid';
    summary.textContent = '输入校验未通过，请修正后重新复核：';
    errorsBox.hidden = false;
    const ul = document.createElement('ul');
    for (const { message } of result.errors) {
      const li = document.createElement('li');
      li.textContent = message;
      ul.appendChild(li);
    }
    errorsBox.appendChild(ul);
    return;
  }

  if (result.status === 'error') {
    summary.className = 'summary error';
    summary.textContent = '计算发生异常：';
    errorsBox.hidden = false;
    const ul = document.createElement('ul');
    for (const { message } of result.errors) {
      const li = document.createElement('li');
      li.textContent = message;
      ul.appendChild(li);
    }
    errorsBox.appendChild(ul);
    return;
  }

  if (result.status === 'ok') {
    summary.className = 'summary ok';
    summary.textContent =
      `存在覆盖全部 ${result.vertexCount} 个通道的完美匹配，共 ${result.pairs.length} 对：`;
    successView.hidden = false;
    for (let i = 0; i < result.pairs.length; i++) {
      const [a, b] = result.pairs[i];
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${i + 1}</td><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td>`;
      pairsBody.appendChild(tr);
    }
    return;
  }

  if (result.status === 'no-perfect') {
    const c = result.certificate;
    summary.className = 'summary no-perfect';
    summary.textContent =
      `最大匹配仅覆盖 ${result.matchedVertices} / ${result.vertexCount} 个通道` +
      `（仍有 ${result.vertexCount - result.matchedVertices} 个暴露点），不存在完美匹配：`;
    failureView.hidden = false;
    sSizeEl.textContent = String(c.sSize);
    oddCountEl.textContent = String(c.oddComponentCount);
    inequalityEl.textContent = `q(S) = ${c.oddComponentCount} > |S| = ${c.sSize} ✓`;

    if (c.s.length === 0) {
      const li = document.createElement('li');
      li.textContent = '∅（空集）';
      sList.appendChild(li);
    }
    for (const id of c.s) {
      const li = document.createElement('li');
      li.textContent = id;
      sList.appendChild(li);
    }

    c.oddComponents.forEach((comp, idx) => {
      const card = document.createElement('div');
      card.className = 'component-card';

      const head = document.createElement('header');
      head.innerHTML =
        `<span>奇数连通分量 #${idx + 1}</span><span>${comp.size} 个顶点（奇数）</span>`;
      card.appendChild(head);

      const verts = document.createElement('div');
      verts.className = 'verts';
      for (const v of comp.vertices) {
        const span = document.createElement('span');
        span.textContent = v;
        verts.appendChild(span);
      }
      card.appendChild(verts);

      const cross = document.createElement('div');
      cross.className = 'cross';
      if (comp.edgesToS.length === 0) {
        cross.textContent = '该分量无任何边连向 S（奇分量自身即构成阻塞）。';
      } else {
        cross.textContent =
          '通向 S 的边（可在原图核对）：' +
          comp.edgesToS.map(([a, b]) => `${a} — ${b}`).join('；');
      }
      card.appendChild(cross);

      oddComponentsEl.appendChild(card);
    });
  }
}

function doCheck() {
  if (!workerOk) {
    createWorker();
    if (!workerOk) return;
  }
  checkBtn.disabled = true;
  setWorkerStatus('busy', 'Worker 正在执行 Edmonds 缩花匹配…');
  inflightId += 1;
  worker.postMessage({
    type: 'solve',
    id: inflightId,
    channelText: channelsEl.value,
    edgeText: edgesEl.value,
  });
}

function updateChannelCount() {
  const ids = channelsEl.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const unique = new Set(ids);
  let text = `当前 ${ids.length} 行，${unique.size} 个唯一通道。`;
  if (ids.length >= 3 && ids.length <= 48 && unique.size === ids.length) {
    text += ids.length % 2 === 0 ? ' 数量为偶数 ✓' : ' 数量为奇数 ✗（完整配对需偶数）';
  }
  channelCountEl.textContent = text;
}

function fillSample(sample) {
  channelsEl.value = sample.channels.join('\n');
  edgesEl.value = sample.edges.map(([a, b]) => `${a} ${b}`).join('\n');
  updateChannelCount();
  clearResult();
}

// 可完美配对示例：6 个顶点，包含三角形 C01-C02-C03（非二分图结构，必须靠缩花处理）
const SAMPLE_OK = {
  channels: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'],
  edges: [
    ['C01', 'C02'],
    ['C01', 'C03'],
    ['C02', 'C03'], // 奇环：二分图算法会在此失败
    ['C03', 'C04'],
    ['C04', 'C05'],
    ['C04', 'C06'],
    ['C05', 'C06'],
  ],
};

// 无法配对示例：8 个通道，移除 HUB 后裂出 3 个 factor-critical 奇分量
// （三角形 {A1,A2,A3}、三角形 {B1,B2,B3}、孤立点 {C1}），3 > 1
const SAMPLE_FAIL = {
  channels: ['HUB', 'A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1'],
  edges: [
    ['HUB', 'A1'],
    ['HUB', 'B1'],
    ['HUB', 'C1'],
    ['A1', 'A2'],
    ['A2', 'A3'],
    ['A3', 'A1'],
    ['B1', 'B2'],
    ['B2', 'B3'],
    ['B3', 'B1'],
  ],
};

channelsEl.addEventListener('input', updateChannelCount);
checkBtn.addEventListener('click', doCheck);
$('sampleOkBtn').addEventListener('click', () => fillSample(SAMPLE_OK));
$('sampleFailBtn').addEventListener('click', () => fillSample(SAMPLE_FAIL));
$('clearBtn').addEventListener('click', () => {
  channelsEl.value = '';
  edgesEl.value = '';
  updateChannelCount();
  clearResult();
});

createWorker();
updateChannelCount();

// 页脚展示服务健康状态（页面计算本身在 Worker 内完成，健康检查仅指示宿主服务）
fetch('./healthz')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((body) => {
    $('healthFlag').textContent = `服务健康：${body.status}`;
    $('healthFlag').style.color = 'var(--ok)';
  })
  .catch(() => {
    $('healthFlag').textContent = '服务健康检查失败';
    $('healthFlag').style.color = 'var(--err)';
  });
