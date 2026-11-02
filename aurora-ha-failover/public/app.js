// The page for spec section 6: one row per request, newest first.

const MAX_ROWS = 50;
const rows = document.getElementById('rows');
const auto = document.getElementById('auto');
let via = 'direct';
let autoTimer;

const instanceColours = {
  1: 'var(--i1)',
  2: 'var(--i2)',
  3: 'var(--i3)',
};

function colourOf(instance) {
  const suffix = instance.split('-').at(-1);
  return instanceColours[suffix] ?? 'var(--i-other)';
}

function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'style') node.style.cssText = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function nodeCell(node) {
  if (!node.ok) {
    return el('td', {}, [
      el('span', { class: 'chip error', title: node.message }, node.code),
      el('div', { class: 'sub num' }, `${node.latencyMs} ms`),
    ]);
  }
  const role = node.isReader ? 'reader' : 'writer';
  return el('td', {}, [
    el('span', { class: 'chip', style: `color: ${colourOf(node.instance)}` }, node.instance),
    el('div', { class: 'sub num' }, `${node.az} · ${role} · ${node.latencyMs} ms`),
  ]);
}

function addRow(cells) {
  const empty = rows.querySelector('.empty');
  if (empty) empty.parentElement.remove();
  rows.prepend(el('tr', {}, cells));
  while (rows.children.length > MAX_ROWS) rows.lastElementChild.remove();
}

async function request(fresh) {
  const started = new Date();
  const time = started.toLocaleTimeString([], { hour12: false });
  try {
    const response = await fetch(`/api/whoami?via=${via}&fresh=${fresh ? 1 : 0}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? response.statusText);
    addRow([
      el('td', { class: 'num' }, time),
      el('td', {}, [body.app.taskId.slice(0, 8), el('div', { class: 'sub' }, body.app.az)]),
      nodeCell(body.writer),
      nodeCell(body.reader),
      el('td', {}, [
        body.via,
        el('div', { class: 'sub' }, body.fresh ? 'fresh connection' : 'warm pool'),
      ]),
    ]);
  } catch (error) {
    addRow([
      el('td', { class: 'num' }, time),
      el('td', { colspan: '4' }, el('span', { class: 'chip error' }, error.message)),
    ]);
  }
}

document.getElementById('request').addEventListener('click', () => request(false));
document.getElementById('fresh').addEventListener('click', () => request(true));

for (const button of document.querySelectorAll('[data-via]')) {
  button.addEventListener('click', () => {
    via = button.dataset.via;
    for (const other of document.querySelectorAll('[data-via]')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
  });
}

auto.addEventListener('change', () => {
  clearInterval(autoTimer);
  if (auto.checked) autoTimer = setInterval(() => request(false), 1000);
});

// The proxy option lights up once M2 configures it.
fetch('/api/config')
  .then((response) => response.json())
  .then((config) => {
    if (config.vias.includes('proxy')) {
      const button = document.querySelector('[data-via="proxy"]');
      button.disabled = false;
      button.removeAttribute('title');
    }
  })
  .catch(() => undefined);

// ---------------------------------------------------------------------------
// The prober timeline: three lanes, the last five minutes, polled once a second.
// ---------------------------------------------------------------------------

const WINDOW_MS = 5 * 60_000;
const MODES = ['naive', 'tuned', 'proxy'];
// When one pixel column holds several ticks, the worst one is drawn, so a single error is never
// hidden behind the ok ticks around it.
const SEVERITY = { ok: 0, skipped: 1, timeout: 2, error: 3 };

const lanesEl = document.getElementById('lanes');
const runEl = document.getElementById('run');
const lanes = new Map();
let since = Date.now() - WINDOW_MS;
let runId;

for (const mode of MODES) {
  const canvas = el('canvas');
  const stats = el('div', { class: 'sub num' }, 'waiting for the prober');
  lanesEl.append(
    el('div', { class: 'lane' }, [el('div', { class: 'lane-name' }, mode), canvas, stats]),
  );
  lanes.set(mode, { canvas, stats, samples: [] });
}

function cssColour(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawLane(lane, now) {
  const { canvas, samples } = lane;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);

  const colours = {
    ok: cssColour('--ok'),
    error: cssColour('--error'),
    timeout: cssColour('--timeout'),
    skipped: cssColour('--skipped'),
  };
  const start = now - WINDOW_MS;
  const xOf = (time) => Math.floor(((time - start) / WINDOW_MS) * width);

  const columns = new Array(width);
  for (const sample of samples) {
    const x = xOf(sample.startedAt);
    if (x < 0 || x >= width) continue;
    const current = columns[x];
    if (!current || SEVERITY[sample.outcome] > SEVERITY[current]) columns[x] = sample.outcome;
  }
  const barTop = Math.round(height * 0.45);
  for (let x = 0; x < width; x++) {
    if (!columns[x]) continue;
    context.fillStyle = colours[columns[x]];
    context.fillRect(x, barTop, 1, height - barTop);
  }

  // A label wherever the writer that acknowledged the INSERT changes.
  context.fillStyle = cssColour('--text');
  context.font = `${11 * ratio}px system-ui, sans-serif`;
  context.textBaseline = 'top';
  let previous;
  for (const sample of samples) {
    if (sample.outcome !== 'ok' || !sample.writerInstance) continue;
    if (sample.writerInstance !== previous) {
      const x = Math.max(0, xOf(sample.startedAt));
      context.fillRect(x, 0, Math.max(1, ratio), height);
      context.fillText(sample.writerInstance, x + 4 * ratio, 2 * ratio);
      previous = sample.writerInstance;
    }
  }
}

function laneStats(samples) {
  const counts = { ok: 0, error: 0, timeout: 0, skipped: 0 };
  for (const sample of samples) counts[sample.outcome]++;
  const last = samples.at(-1);
  const writer =
    samples.findLast((sample) => sample.outcome === 'ok')?.writerInstance ?? 'none yet';
  const lastError = samples.findLast((sample) => sample.outcome !== 'ok');
  const errorText = lastError
    ? ` · last problem ${lastError.code ?? lastError.outcome} at ${new Date(lastError.settledAt).toLocaleTimeString([], { hour12: false })}`
    : '';
  const latency = last && last.outcome === 'ok' ? ` · ${last.settledAt - last.startedAt} ms` : '';
  return `writer ${writer}${latency} · ${counts.ok} ok, ${counts.error} error, ${counts.timeout} timeout, ${counts.skipped} skipped${errorText}`;
}

async function pollTimeline() {
  try {
    const response = await fetch(`/prober/timeline?since=${since}`);
    if (!response.ok) throw new Error(response.statusText);
    const body = await response.json();
    if (runId && body.runId !== runId) {
      // The prober restarted: its sequence numbers start over, so start the lanes over too.
      for (const lane of lanes.values()) lane.samples = [];
    }
    runId = body.runId;
    runEl.textContent = `run ${runId.slice(0, 8)}`;
    for (const sample of body.samples) lanes.get(sample.mode)?.samples.push(sample);
    if (body.samples.length > 0) since = body.samples.at(-1).settledAt;

    const cutoff = body.now - WINDOW_MS;
    for (const [mode, lane] of lanes) {
      lane.samples = lane.samples.filter((sample) => sample.settledAt >= cutoff);
      drawLane(lane, body.now);
      lane.stats.textContent = lane.samples.length
        ? laneStats(lane.samples)
        : mode === 'proxy'
          ? 'no samples: is RDS Proxy configured?'
          : 'no samples yet';
    }
  } catch (error) {
    runEl.textContent = `prober unreachable: ${error.message}`;
  } finally {
    setTimeout(pollTimeline, 1000);
  }
}

pollTimeline();
