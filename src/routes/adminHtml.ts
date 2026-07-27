import type { InstructionVersion, BotStats } from '../db/store.js';

/**
 * Server-rendered HTML for the admin instructions page. Framework-free: one page
 * with inline CSS + a little vanilla JS (state lives in the browser; every action
 * POSTs JSON to /admin/*). Styled after the approved mockup (blue #3b5bdb).
 * Non-technical audience — plain words, confirmations on destructive actions,
 * clear draft-vs-live signaling.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:#1c2230; background:#eef0f4; }
  a { color:#3b5bdb; }
  .wrap { max-width:840px; margin:0 auto; padding:24px 18px 80px; }
  .card { background:#fff; border:1px solid #e4e7ee; border-radius:14px; padding:22px; margin-bottom:18px; }
  h1 { font-size:22px; } h2 { font-size:17px; margin-bottom:4px; }
  .muted { color:#6b7280; font-size:14px; }
  .row { display:flex; align-items:center; gap:12px; }
  .spread { justify-content:space-between; }
  button { font:inherit; font-weight:600; cursor:pointer; border-radius:10px; padding:10px 16px; border:1px solid #d6d9e0; background:#fff; color:#333; }
  button:hover { background:#f5f6f8; }
  .primary { background:#3b5bdb; color:#fff; border:none; } .primary:hover { background:#2b46b8; }
  .danger { color:#b3403a; border-color:#ecd2d0; } .danger:hover { background:#fdf0ef; }
  .small { padding:7px 12px; font-size:13.5px; }
  textarea { width:100%; font:inherit; padding:10px 12px; border:1px solid #d6d9e0; border-radius:10px; resize:vertical; min-height:64px; }
  input[type=text],input[type=password] { width:100%; font:inherit; padding:11px 13px; border:1px solid #d6d9e0; border-radius:10px; }
  .step { border:1px solid #e6e8ee; border-radius:12px; padding:12px; margin-bottom:12px; }
  .step .num { font-weight:700; color:#3b5bdb; }
  .banner { background:#fff7e0; border:1px solid #f0e0b0; color:#8a6a12; border-radius:10px; padding:11px 14px; margin-bottom:16px; font-weight:600; font-size:14.5px; }
  .warns { background:#fff7e0; border:1px solid #f0e0b0; border-radius:10px; padding:12px 14px; margin:10px 0; }
  .warns li { margin-left:18px; color:#8a6a12; font-size:14px; }
  .chip { display:inline-block; font-size:12px; font-weight:700; padding:2px 9px; border-radius:99px; }
  .live { background:#e7f6ec; color:#1f7a45; } .draftchip { background:#eef1fb; color:#3b5bdb; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  td,th { text-align:left; padding:8px 6px; border-bottom:1px solid #eef0f4; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .stat { background:#f7f8fb; border:1px solid #e6e8ee; border-radius:12px; padding:14px; }
  .stat .n { font-size:26px; font-weight:800; } .stat .l { font-size:13px; color:#6b7280; }
  .bars { display:flex; align-items:flex-end; gap:6px; height:70px; margin-top:8px; }
  .bar { flex:1; background:#3b5bdb; border-radius:4px 4px 0 0; min-height:3px; }
  .bubble { background:#eef1fb; border-radius:12px; padding:11px 14px; white-space:pre-wrap; margin-top:10px; }
  .quiet { color:#6b7280; font-style:italic; }
  .modal-bg { position:fixed; inset:0; background:rgba(20,24,35,.45); display:none; align-items:center; justify-content:center; padding:20px; }
  .modal-bg.on { display:flex; }
  .modal { background:#fff; border-radius:14px; padding:22px; max-width:440px; width:100%; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .chips button { font-size:13px; padding:7px 13px; border-radius:99px; background:#f5f6f8; }
`;

export function loginPage(error?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot Instructions — staff only</title><style>${CSS}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .login{max-width:380px;width:100%;}</style></head>
<body><div class="login card">
  <h1>Bot Instructions</h1>
  <p class="muted" style="margin:6px 0 16px">Staff only. Enter the password.</p>
  ${error ? `<p style="color:#b3403a;font-size:14px;margin-bottom:10px">${esc(error)}</p>` : ''}
  <form method="post" action="/admin/login">
    <input type="text" name="username" placeholder="Username" autocomplete="username" autofocus required>
    <input type="password" name="password" placeholder="Password" autocomplete="current-password" style="margin-top:10px" required>
    <button class="primary" style="width:100%;margin-top:12px" type="submit">Log in</button>
  </form>
</div></body></html>`;
}

export function editorPage(data: {
  live: InstructionVersion | null;
  draft: InstructionVersion | null;
  history: InstructionVersion[];
  stats: BotStats;
}): string {
  // The editor works on the DRAFT if one exists, else a copy of LIVE.
  const workingSteps = (data.draft ?? data.live)?.steps ?? [];
  const liveVer = data.live?.version ?? '—';
  const hasDraft = !!data.draft && !!data.live &&
    JSON.stringify(data.draft.steps) !== JSON.stringify(data.live.steps);

  const stepsJson = JSON.stringify(workingSteps);
  const s = data.stats;
  const maxDay = Math.max(1, ...s.inboundByDay.map((d) => d.count));
  const bars = s.inboundByDay
    .map((d) => `<div class="bar" title="${d.date}: ${d.count}" style="height:${Math.round((d.count / maxDay) * 100)}%"></div>`)
    .join('');

  const historyRows = data.history
    .map((v) => {
      const isLive = v.status === 'live';
      const when = v.publishedAt ? new Date(v.publishedAt).toLocaleString() : '—';
      return `<tr>
        <td>v${v.version} ${isLive ? '<span class="chip live">Live</span>' : v.status === 'draft' ? '<span class="chip draftchip">Draft</span>' : ''}</td>
        <td>${esc(when)}</td>
        <td>${esc(v.note ?? '')}</td>
        <td>${isLive ? '' : `<button class="small" onclick="restore('${v.id}')">Restore</button>`}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot Instructions</title><style>${CSS}</style></head><body><div class="wrap">

  <div class="row spread" style="margin-bottom:16px">
    <div><h1>Bot Instructions</h1><p class="muted">Edit how the SMS bot replies to customers.</p></div>
    <form method="post" action="/admin/logout"><button class="small" type="submit">Log out</button></form>
  </div>

  <div id="banner" class="banner" style="display:${hasDraft ? 'block' : 'none'}">
    You have unpublished changes — customers still see version ${liveVer} until you Publish.
  </div>

  <!-- STEPS -->
  <div class="card">
    <h2>How the bot helps customers</h2>
    <p class="muted" style="margin-bottom:12px">Each step is a short instruction, in order.</p>
    <div id="steps"></div>
    <button class="small" onclick="addStep()">+ Add step</button>
    <div class="row" style="margin-top:14px;gap:10px">
      <button class="primary" onclick="saveDraft()">Save draft</button>
      <span id="saveMsg" class="muted"></span>
    </div>
  </div>

  <!-- PREVIEW -->
  <div class="card">
    <h2>Try it before you publish</h2>
    <p class="muted">Nothing is sent to any customer. Uses the steps above.</p>
    <div class="row" style="margin-top:10px;gap:8px">
      <input type="text" id="pvInput" placeholder="Type a customer message…">
      <button class="primary" onclick="runPreview()">Run preview</button>
    </div>
    <div class="chips">
      ${['95 Accord front bumper', 'GM1000683', 'civic bumper', 'what time do you open saturday?']
        .map((t) => `<button onclick="pick(this)">${esc(t)}</button>`)
        .join('')}
    </div>
    <div id="pvOut"></div>
  </div>

  <!-- PUBLISH -->
  <div class="card">
    <h2>Publish</h2>
    <p class="muted" style="margin-bottom:10px">Make your changes live for customers.</p>
    <button class="primary" onclick="openPublish()">Review &amp; publish</button>
  </div>

  <!-- DASHBOARD -->
  <div class="card">
    <h2>Activity</h2>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="n">${s.inboundToday}</div><div class="l">Messages today</div></div>
      <div class="stat"><div class="n">${s.repliesToday}</div><div class="l">Bot replies today</div></div>
      <div class="stat"><div class="n">${s.handoffs7d}</div><div class="l">Handed to staff (7d)</div></div>
      <div class="stat"><div class="n">${s.holds7d}</div><div class="l">Holds created (7d)</div></div>
    </div>
    <p class="muted" style="margin-top:14px">Messages per day (last 7 days)</p>
    <div class="bars">${bars || '<span class="muted">No data yet.</span>'}</div>
  </div>

  <!-- HISTORY -->
  <div class="card">
    <h2>Previous versions</h2>
    <table style="margin-top:8px"><thead><tr><th>Version</th><th>Published</th><th>Note</th><th></th></tr></thead>
    <tbody>${historyRows || '<tr><td colspan="4" class="muted">No versions yet.</td></tr>'}</tbody></table>
  </div>
</div>

<!-- Publish modal -->
<div id="pubModal" class="modal-bg"><div class="modal">
  <h2>Publish these instructions?</h2>
  <p class="muted" style="margin:6px 0 12px">Customers will start seeing this version right away.</p>
  <div id="pubWarns"></div>
  <input type="text" id="pubNote" placeholder="What changed? (optional note)" style="margin-bottom:14px">
  <div class="row" style="gap:10px;justify-content:flex-end">
    <button onclick="closeModal()">Cancel</button>
    <button class="primary" onclick="confirmPublish()">Yes, publish</button>
  </div>
</div></div>

<script>
const initial = ${stepsJson};
let steps = initial.slice();

function render() {
  const box = document.getElementById('steps');
  box.innerHTML = '';
  steps.forEach((text, i) => {
    const d = document.createElement('div'); d.className = 'step';
    d.innerHTML = '<div class="row spread" style="margin-bottom:6px"><span class="num">Step ' + (i+1) + '</span>' +
      '<span><button class="small" onclick="move('+i+',-1)">↑ Up</button> ' +
      '<button class="small" onclick="move('+i+',1)">↓ Down</button> ' +
      '<button class="small danger" onclick="del('+i+')">Delete</button></span></div>';
    const ta = document.createElement('textarea');
    ta.value = text; ta.oninput = () => { steps[i] = ta.value; };
    d.appendChild(ta); box.appendChild(d);
  });
}
function addStep(){ steps.push(''); render(); }
function del(i){ if(confirm('Delete this step?')){ steps.splice(i,1); render(); } }
function move(i,dir){ const j=i+dir; if(j<0||j>=steps.length) return; [steps[i],steps[j]]=[steps[j],steps[i]]; render(); }
function pick(b){ document.getElementById('pvInput').value = b.textContent; }

async function saveDraft(){
  const msg = document.getElementById('saveMsg');
  msg.textContent = 'Saving…';
  const r = await fetch('/admin/steps',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({steps})});
  const j = await r.json();
  if(!j.ok){ msg.textContent=''; alert('Could not save:\\n'+(j.errors||[]).join('\\n')); return; }
  msg.textContent = 'Saved.'; document.getElementById('banner').style.display='block';
}
async function runPreview(){
  const message = document.getElementById('pvInput').value.trim();
  if(!message) return;
  const out = document.getElementById('pvOut');
  out.innerHTML = '<div class="bubble quiet">Running…</div>';
  const r = await fetch('/admin/preview',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({steps,message})});
  const j = await r.json();
  if(j.silent){ out.innerHTML = '<div class="bubble quiet">Bot stayed quiet (a staff member would handle this).</div>'; }
  else { out.innerHTML = '<div class="muted" style="margin-top:8px">Bot would reply:</div><div class="bubble">'+escapeHtml(j.reply)+'</div>'; }
}
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

async function openPublish(){
  await saveDraft();
  const r = await fetch('/admin/lint',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({steps})});
  const j = await r.json();
  const w = document.getElementById('pubWarns');
  if(j.warnings && j.warnings.length){
    w.innerHTML = '<div class="warns"><b>Please double-check these:</b><ul>' +
      j.warnings.map(x=>'<li>'+escapeHtml(x.message)+'</li>').join('') +
      '</ul><p class="muted" style="margin-top:6px">You can still publish — just make sure this is what you want.</p></div>';
  } else { w.innerHTML=''; }
  document.getElementById('pubModal').classList.add('on');
}
function closeModal(){ document.getElementById('pubModal').classList.remove('on'); }
async function confirmPublish(){
  const note = document.getElementById('pubNote').value;
  const r = await fetch('/admin/publish',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({note})});
  const j = await r.json();
  if(j.ok){ location.reload(); } else { alert('Publish failed.'); }
}
async function restore(id){
  if(!confirm('Restore this version as a new draft?')) return;
  const r = await fetch('/admin/rollback',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({versionId:id})});
  const j = await r.json();
  if(j.ok){ location.reload(); } else { alert('Restore failed.'); }
}
render();
</script></body></html>`;
}
