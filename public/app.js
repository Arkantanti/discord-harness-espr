'use strict';
const $ = (id) => document.getElementById(id);
const api = async (path, opts) => {
  const res = await fetch('/api' + path, opts && {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

let agents = [];
let selected = null;       // agent id
let lastEventId = 0;
let watchersOpen = false;

// ---------- sidebar ----------
async function refreshAgents() {
  agents = await api('/agents');
  renderAgentList();
  if (selected) renderAgentHead();
}

function statusClass(a) {
  if (a.status === 'idle' && a.pendingMessages > 0) return 'queued';
  return a.status;
}

function renderAgentList() {
  const byParent = {};
  agents.forEach((a) => ((byParent[a.parentId || ''] ||= []).push(a)));
  const el = $('agent-list');
  el.innerHTML = '';
  const add = (a, depth) => {
    const row = document.createElement('div');
    row.className = 'agent-row' + (a.id === selected ? ' selected' : '');
    row.style.paddingLeft = 12 + depth * 16 + 'px';
    row.innerHTML =
      `<span class="dot ${statusClass(a)}"></span>` +
      `<span class="name">${a.name}</span>` +
      (a.pendingMessages ? `<span class="badge">${a.pendingMessages}</span>` : '') +
      `<span class="cost">$${a.totalCostUsd.toFixed(2)}</span>`;
    row.onclick = () => selectAgent(a.id);
    el.appendChild(row);
    (byParent[a.id] || []).forEach((c) => add(c, depth + 1));
  };
  (byParent[''] || []).forEach((a) => add(a, 0));
}

// ---------- agent view ----------
async function selectAgent(id) {
  selected = id;
  lastEventId = 0;
  $('empty-state').hidden = true;
  $('agent-view').hidden = false;
  $('transcript').innerHTML = '';
  renderAgentList();
  renderAgentHead();
  if (watchersOpen) await renderWatchers();
  const evs = await api(`/agents/${id}/events?limit=300`);
  evs.forEach(appendEvent);
  scrollToBottom(true);
}

function agentById(id) {
  return agents.find((a) => a.id === id);
}

function renderAgentHead() {
  const a = agentById(selected);
  if (!a) return;
  $('ah-dot').className = 'dot ' + statusClass(a);
  $('ah-name').textContent = a.name;
  $('ah-id').textContent = a.id;
  $('ah-meta').textContent =
    `${a.status} · ${a.totalTurns} turns · $${a.totalCostUsd.toFixed(3)}` +
    (a.model ? ` · ${a.model}` : '') + (a.lastError ? ` · last error: ${a.lastError.slice(0, 80)}` : '');
  $('btn-retry').hidden = a.status !== 'failed';
  $('btn-terminate').disabled = a.status === 'terminated';
}

// ---------- transcript ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function appendEvent(ev) {
  if (ev.id <= lastEventId) return;
  lastEventId = Math.max(lastEventId, ev.id);
  const t = $('transcript');
  const p = ev.payload;
  let node = null;
  switch (ev.kind) {
    case 'inbox': {
      node = el('div', 'ev ev-inbox');
      const from = p.fromType === 'user' ? 'user (web ui)' : `${p.fromType} ${p.fromLabel || p.fromId || ''}`;
      node.appendChild(el('div', 'from', from));
      node.appendChild(el('div', 'ev-text', p.content));
      break;
    }
    case 'assistant_text':
      node = el('div', 'ev ev-text', p.text);
      break;
    case 'tool_use': {
      node = el('div', 'ev ev-tool');
      const head = el('div', null, `▸ ${p.name}`);
      const body = el('div', 'body', typeof p.input === 'string' ? p.input : JSON.stringify(p.input, null, 2));
      node.append(head, body);
      node.onclick = () => node.classList.toggle('open');
      break;
    }
    case 'tool_result': {
      node = el('div', 'ev ev-tool' + (p.isError ? ' err' : ''));
      const head = el('div', null, `  ↳ result${p.isError ? ' (error)' : ''}`);
      const body = el('div', 'body', String(p.content ?? ''));
      node.append(head, body);
      node.onclick = () => node.classList.toggle('open');
      break;
    }
    case 'result': {
      node = el('div', 'ev-sep');
      const span = el('span', null, `turn done · $${(p.costUsd ?? 0).toFixed(3)} · ${p.numTurns} steps`);
      node.appendChild(span);
      break;
    }
    case 'spawn':
      node = el('div', 'ev ev-sys', `⑂ spawned ${p.childName} (${p.childId})`);
      break;
    case 'terminate':
      node = el('div', 'ev ev-sys', `✕ terminated by ${p.by}`);
      break;
    case 'watcher_fired':
      node = el('div', 'ev ev-sys', `⏰ watcher fired: ${p.name || p.type} (${p.watcherId})`);
      break;
    case 'watcher_error':
      node = el('div', 'ev ev-err', `watcher error [${p.type}]: ${p.error}`);
      break;
    case 'watcher_log':
      node = el('div', 'ev ev-sys', `watcher log: ${p.msg}`);
      break;
    case 'error':
      node = el('div', 'ev ev-err', `turn error${p.willRetry ? ' (will retry)' : ''}: ${p.error}`);
      break;
    case 'system':
      node = el('div', 'ev ev-sys', `⚙ ${p.note || JSON.stringify(p)}`);
      break;
    default:
      node = el('div', 'ev ev-sys muted', `${ev.kind}: ${JSON.stringify(p).slice(0, 200)}`);
  }
  if (node) t.appendChild(node);
  scrollToBottom(false);
}

function scrollToBottom(force) {
  const t = $('transcript');
  const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 200;
  if (force || nearBottom) t.scrollTop = t.scrollHeight;
}

// ---------- watchers panel ----------
async function renderWatchers() {
  const list = $('watcher-list');
  const [ws, typesRes] = await Promise.all([api(`/agents/${selected}/watchers`), api('/watcher-types')]);
  list.innerHTML = ws.length ? '' : '<div class="muted">no watchers</div>';
  ws.forEach((w) => {
    const row = el('div', 'watcher-row');
    row.appendChild(el('span', null, `${w.enabled ? '●' : '○'} ${w.name || w.type} [${w.type}] fired ${w.fireCount}×`));
    if (w.lastError) row.appendChild(el('span', 'wr-err', w.lastError.slice(0, 60)));
    const cfg = el('span', 'muted', w.config.length > 60 ? w.config.slice(0, 60) + '…' : w.config);
    row.appendChild(cfg);
    const toggle = el('button', null, w.enabled ? 'disable' : 'enable');
    toggle.onclick = async () => { await api(`/agents/${selected}/watchers/${w.id}`, { method: 'PATCH', body: { enabled: !w.enabled } }); renderWatchers(); };
    const del = el('button', 'danger', 'delete');
    del.onclick = async () => { await api(`/agents/${selected}/watchers/${w.id}`, { method: 'DELETE' }); renderWatchers(); };
    row.append(toggle, del);
    list.appendChild(row);
  });
  const sel = $('wf-type');
  sel.innerHTML = '';
  typesRes.types.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.type;
    o.textContent = t.type;
    o.title = t.description;
    sel.appendChild(o);
  });
}

// ---------- SSE ----------
function connectSse() {
  const es = new EventSource('/api/stream');
  es.onmessage = (m) => {
    const data = JSON.parse(m.data);
    if (data.type === 'agent_status') refreshAgents();
    if (data.type === 'event' && data.event.agentId === selected) appendEvent(data.event);
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectSse, 3000);
  };
}

// ---------- wiring ----------
$('btn-spawn').onclick = () => $('spawn-dialog').showModal();
$('sf-cancel').onclick = () => $('spawn-dialog').close();
$('spawn-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const a = await api('/agents', { body: {
      name: $('sf-name').value.trim(),
      prompt: $('sf-prompt').value,
      model: $('sf-model').value.trim() || undefined,
      systemPrompt: $('sf-system').value.trim() || undefined,
    }});
    $('spawn-dialog').close();
    $('spawn-form').reset();
    await refreshAgents();
    selectAgent(a.id);
  } catch (err) { alert(err.message); }
};

$('composer').onsubmit = async (e) => {
  e.preventDefault();
  const content = $('msg-input').value.trim();
  if (!content || !selected) return;
  try {
    await api(`/agents/${selected}/message`, { body: { content } });
    $('msg-input').value = '';
  } catch (err) { alert(err.message); }
};
$('msg-input').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
};

$('btn-terminate').onclick = async () => {
  if (!confirm('Terminate this agent (and abort its in-flight turn)?')) return;
  await api(`/agents/${selected}/terminate`, { body: { recursive: false } });
  refreshAgents();
};
$('btn-retry').onclick = async () => { await api(`/agents/${selected}/retry`, { body: {} }); refreshAgents(); };
$('btn-watchers').onclick = async () => {
  watchersOpen = !watchersOpen;
  $('watcher-panel').hidden = !watchersOpen;
  if (watchersOpen) await renderWatchers();
};
$('watcher-form').onsubmit = async (e) => {
  e.preventDefault();
  let config;
  try { config = JSON.parse($('wf-config').value || '{}'); } catch { return alert('config must be valid JSON'); }
  try {
    await api(`/agents/${selected}/watchers`, { body: { type: $('wf-type').value, name: $('wf-name').value.trim() || undefined, config } });
    $('wf-name').value = ''; $('wf-config').value = '';
    renderWatchers();
  } catch (err) { alert(err.message); }
};

refreshAgents();
connectSse();
