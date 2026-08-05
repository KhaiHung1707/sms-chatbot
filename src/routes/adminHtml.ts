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
  .note { border:1px solid #e4e7ee; border-radius:10px; margin:10px 0; background:#fafbfc; }
  .note summary { cursor:pointer; padding:11px 14px; font-weight:600; font-size:14px; color:#3b5bdb; list-style:none; }
  .note summary::-webkit-details-marker { display:none; }
  .note summary::before { content:"ⓘ "; }
  .note[open] summary { border-bottom:1px solid #eef0f4; }
  .note-body { padding:12px 16px; font-size:14px; color:#3a4150; }
  .note-body p { margin:8px 0; } .note-body ul { margin:6px 0 10px 20px; } .note-body li { margin:3px 0; }
  .reply-sample { background:#eef1fb; border:1px solid #dbe1f5; border-radius:10px; padding:11px 13px; margin:8px 0; font:13px/1.5 ui-monospace,Menlo,Consolas,monospace; color:#1c2230; white-space:pre-wrap; overflow-x:auto; }
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
  /* Preview conversation — a phone-like chat window */
  .pvwindow { margin-top:12px; border:1px solid #e0e3ea; border-radius:16px; overflow:hidden; background:#f7f8fb; }
  .pvhead { display:flex; align-items:center; gap:9px; padding:11px 15px; background:#fff; border-bottom:1px solid #eef0f4; }
  .pvhead .dot { width:9px; height:9px; border-radius:99px; background:#3e8a5f; }
  .pvhead .t { font-weight:700; font-size:14px; } .pvhead .s { font-size:12px; color:#9aa0ab; }
  .pvchat { padding:16px 15px; display:flex; flex-direction:column; gap:12px; min-height:90px; max-height:380px; overflow-y:auto; }
  .pvempty { color:#9aa0ab; font-size:13.5px; text-align:center; padding:22px 10px; }
  .msg { max-width:78%; padding:9px 13px; border-radius:16px; white-space:pre-wrap; font-size:14.5px; line-height:1.45; box-shadow:0 1px 1px rgba(20,24,35,.05); }
  .msg.cust { background:#3b5bdb; color:#fff; border-bottom-right-radius:5px; }
  .msg.bot { background:#fff; color:#1c2230; border:1px solid #e6e8ee; border-bottom-left-radius:5px; }
  .msg.sys { align-self:center; background:#eef0f4; color:#6b7280; font-size:12.5px; padding:5px 12px; border-radius:99px; }
  .msgwrap { display:flex; flex-direction:column; max-width:82%; }
  .msgwrap.cust { align-self:flex-end; align-items:flex-end; }
  .msgwrap.bot { align-self:flex-start; align-items:flex-start; }
  .msgwrap .msg { max-width:100%; }
  .msglabel { font-size:11px; color:#9aa0ab; margin:3px 6px 0; }
  .typing { display:inline-flex; gap:3px; }
  .typing i { width:6px; height:6px; border-radius:99px; background:#b6bcc7; animation:blink 1.2s infinite; }
  .typing i:nth-child(2){ animation-delay:.2s } .typing i:nth-child(3){ animation-delay:.4s }
  @keyframes blink { 0%,60%,100%{opacity:.3} 30%{opacity:1} }
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
    <p class="muted" style="margin-bottom:10px">Each step is a short instruction to the bot, followed in order. Edit the wording to change how the bot talks to customers.</p>
    <details class="note">
      <summary>How the bot finds a part (the words it uses)</summary>
      <div class="note-body">
        <p>To find a part, the bot needs four things from the customer:</p>
        <ul>
          <li><b>Year</b> — e.g. 2015</li>
          <li><b>Make</b> — the brand, e.g. Honda</li>
          <li><b>Model</b> — e.g. Accord</li>
          <li><b>Part</b> — what they need, e.g. front bumper, headlight, side mirror</li>
        </ul>
        <p>If any of these is missing, the steps below tell the bot to ask for it. Once it has all four, it looks up the catalog and shows the matching product.</p>
        <p>When it finds a product, the reply can also include:</p>
        <ul>
          <li><b>Features</b> — the product's highlights (the ✓ bullet points)</li>
          <li><b>Fits</b> — the years and vehicles that part fits (its "fitment")</li>
        </ul>
        <p class="muted">These come straight from the catalog — the bot never makes them up.</p>
      </div>
    </details>
    <details class="note">
      <summary>Where the reply goes, and what a product reply looks like (with Features)</summary>
      <div class="note-body">
        <p>The bot's reply is sent to the customer as a normal <b>text message (SMS)</b> on their phone — the same way you'd text them back. It does not appear on any web page for the customer; it lands in their messages. You can see the full back-and-forth in your Quo (OpenPhone) inbox.</p>
        <p>When the customer gives a <b>vehicle</b> (year, make, model + part), the bot replies like this:</p>
        <pre class="reply-sample">FRONT BUMPER COVER
Current price is: $64.08
SKU: HO1000123
FITS 2015 Honda Accord
Order link: https://oaklandbodyparts.com/…</pre>
        <p>When the customer gives a <b>part number (SKU)</b>, the bot replies with more detail, including a <b>Features</b> list (the ✓ highlights) and every vehicle it <b>Fits</b>:</p>
        <pre class="reply-sample">FRONT BUMPER COVER
SKU: HO1000123
Price: $64.08
Status: In Stock

Features:
✓ Primed, ready to paint
✓ Direct OEM-style fit

Fits:
2013–2015 Honda Accord

Order:
https://oaklandbodyparts.com/…</pre>
        <p class="muted">Everything — price, features, and the fits list — comes straight from the catalog; the bot never makes it up. These reply formats are built in and always applied, so they stay consistent for every customer.</p>
        <p class="muted">The <b>Preview</b> below shows exactly these — but nothing is ever sent to a customer from here. It's only a test.</p>
      </div>
    </details>
    <div class="warns" style="background:#eef1fb;border-color:#c9d4f5">
      <b style="color:#2b46b8">Tips for safe edits</b>
      <ul style="margin-top:6px;color:#3b4a6b;font-size:13.5px">
        <li>Keep any specific numbers you see (like "80%" or "300 characters") — they control how sure the bot is before it answers and how long its replies are.</li>
        <li>Keep the little examples (like "Accord bumper" → "What year…") — they teach the bot exactly what to do.</li>
        <li>Not sure about a change? Use <b>Try it before you publish</b> below to see the bot's reply first.</li>
      </ul>
    </div>
    <div id="steps" style="margin-top:12px"></div>
    <button class="small" onclick="addStep()">+ Add step</button>
    <div class="row" style="margin-top:14px;gap:10px">
      <button class="primary" onclick="saveDraft()">Save draft</button>
      <span id="saveMsg" class="muted"></span>
    </div>
  </div>

  <!-- PREVIEW (multi-turn chat) -->
  <div class="card">
    <div class="row spread">
      <h2>Try it before you publish</h2>
      <button class="small" onclick="resetChat()">Start over</button>
    </div>
    <p class="muted">Have a full back-and-forth with the bot, just like a real customer. Nothing is sent to any customer — it uses the draft steps in the editor above.</p>
    <div class="pvwindow">
      <div class="pvhead">
        <span class="dot"></span>
        <span><span class="t">Preview conversation</span><br><span class="s">Test chat · nothing is sent</span></span>
      </div>
      <div id="pvChat" class="pvchat"><div class="pvempty">Type a message below (or pick a sample) to start the conversation.</div></div>
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <input type="text" id="pvInput" placeholder="Type a customer message…" onkeydown="if(event.key==='Enter')runPreview()">
      <button class="primary" onclick="runPreview()">Run preview</button>
    </div>
    <div class="chips">
      ${['95 Accord front bumper', 'GM1000683', 'civic bumper', 'what time do you open saturday?']
        .map((t) => `<button onclick="pick(this)">${esc(t)}</button>`)
        .join('')}
    </div>
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
    ta.value = text;
    ta.placeholder = 'Write a short instruction, e.g. "Greet the customer warmly and ask what part they need."';
    const hint = document.createElement('div');
    hint.className = 'muted'; hint.style.fontSize = '12.5px'; hint.style.marginTop = '4px';
    const upd = () => { hint.textContent = ta.value.trim().length + ' characters'; };
    ta.oninput = () => { steps[i] = ta.value; upd(); };
    upd();
    d.appendChild(ta); d.appendChild(hint); box.appendChild(d);
  });
}
function addStep(){ steps.push(''); render(); }
function del(i){ if(confirm('Delete this step?')){ steps.splice(i,1); render(); } }
function move(i,dir){ const j=i+dir; if(j<0||j>=steps.length) return; [steps[i],steps[j]]=[steps[j],steps[i]]; render(); }
let chat = []; // preview conversation: [{who:'customer'|'bot', text}]
function pick(b){ document.getElementById('pvInput').value = b.textContent; runPreview(); }
function resetChat(){ chat = []; renderChat(); }
function renderChat(){
  const box = document.getElementById('pvChat');
  if(chat.length===0){
    box.innerHTML = '<div class="pvempty">Type a message below (or pick a sample) to start the conversation.</div>';
    return;
  }
  box.innerHTML = chat.map(m => {
    if(m.who==='typing') return '<div class="msgwrap bot"><div class="msg bot"><span class="typing"><i></i><i></i><i></i></span></div></div>';
    if(m.who==='system') return '<div class="msg sys">'+escapeHtml(m.text)+'</div>';
    if(m.who==='bot') return '<div class="msgwrap bot"><div class="msg bot">'+escapeHtml(m.text)+'</div><div class="msglabel">Answered by the bot</div></div>';
    return '<div class="msgwrap cust"><div class="msg cust">'+escapeHtml(m.text)+'</div><div class="msglabel">You (as the customer)</div></div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function saveDraft(){
  const msg = document.getElementById('saveMsg');
  msg.textContent = 'Saving…';
  const r = await fetch('/admin/steps',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({steps})});
  const j = await r.json();
  if(!j.ok){ msg.textContent=''; alert('Could not save:\\n'+(j.errors||[]).join('\\n')); return; }
  msg.textContent = 'Saved.'; document.getElementById('banner').style.display='block';
}
async function runPreview(){
  const input = document.getElementById('pvInput');
  const message = input.value.trim();
  if(!message) return;
  // Show the customer message; history is everything BEFORE this one.
  const history = chat.filter(m => m.who !== 'system');
  chat.push({who:'customer', text:message});
  input.value = '';
  chat.push({who:'typing'});
  renderChat();
  const r = await fetch('/admin/preview',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({steps,message,history})});
  const j = await r.json();
  chat.pop(); // remove the typing indicator
  if(j.error){ chat.push({who:'system', text:'⚠️ Couldn\'t reach the bot right now (a system error). This is not about your steps — try again in a moment, or check the service.'}); }
  else if(j.silent){ chat.push({who:'system', text:'Bot stayed quiet — a staff member would handle this.'}); }
  else { chat.push({who:'bot', text:j.reply}); }
  renderChat();
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
