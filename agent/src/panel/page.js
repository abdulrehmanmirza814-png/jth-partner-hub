export const pageHtml = (token) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JTH Assistant</title><style>
:root{--bg:#0f1720;--card:#18232f;--ink:#e8eef5;--mut:#8fa3b8;--ok:#2fbf71;--warn:#f0b429;--bad:#e5484d;--acc:#4da3ff}
@media(prefers-color-scheme:light){:root{--bg:#f3f6fa;--card:#fff;--ink:#14202b;--mut:#5a6b7c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:14px}
.card{background:var(--card);border-radius:12px;padding:14px;box-shadow:0 1px 3px #0003}
h1{font-size:18px;margin:0}h2{font-size:14px;margin:0 0 8px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em}
.top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
#state{font-weight:700;padding:4px 10px;border-radius:99px;background:#0003}
button{font:inherit;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;color:#fff;background:var(--acc)}
button.stop{background:var(--bad);font-weight:800;font-size:16px;padding:12px 22px}button.ok{background:var(--ok)}button.gray{background:#6b7c8e}
input[type=text]{width:100%;padding:11px;border-radius:8px;border:1px solid #6b7c8e55;background:transparent;color:var(--ink);font:inherit}
.row{display:flex;gap:8px}#log{font:12px/1.5 ui-monospace,monospace;max-height:240px;overflow:auto;white-space:pre-wrap;color:var(--mut)}
#appr{border:2px solid var(--warn)}img{max-width:100%;border-radius:8px;border:1px solid #6b7c8e44}
textarea{width:100%;min-height:70px;padding:8px;border-radius:8px;border:1px solid #6b7c8e55;background:transparent;color:var(--ink);font:inherit}
.t{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #6b7c8e22}.s{color:var(--mut);font-size:13px}
</style></head><body><main>
<div class="card top"><div><h1>JTH Assistant</h1><div class="s">Runs on this computer. Move the mouse into a screen corner for an emergency stop.</div></div>
<div class="row"><span id="state">...</span><button class="gray" id="toggle">Turn on/off</button><button class="stop" id="stop">STOP</button></div></div>
<div class="card" id="pause" hidden><h2>Paused</h2><div id="pausemsg"></div><p><button class="ok" id="resume">Continue</button></p></div>
<div class="card" id="appr" hidden><h2>Needs your approval</h2><div id="what" style="font-weight:600"></div><div class="s" id="win"></div>
<p><textarea id="atext"></textarea></p><div class="row"><button class="ok" id="yes">Approve</button><button class="stop" id="no" style="font-size:15px;padding:9px 16px">Decline</button></div></div>
<div class="card"><h2>Give a task</h2><div class="row"><input type="text" id="task" placeholder="e.g. Open Gmail and tell me which emails need a reply today"><button id="add">Send</button></div></div>
<div class="card"><h2>Now</h2><div id="now" class="s">Idle</div><p><img id="shot" alt="" hidden></p></div>
<div class="card"><h2>Tasks</h2><div id="tasks"></div></div>
<div class="card"><h2>Activity</h2><div id="log"></div></div>
</main><script>
const T=${JSON.stringify(token)};const H={'content-type':'application/json','x-panel-token':T};
const api=(p,b)=>fetch('/api/'+p,{method:b?'POST':'GET',headers:H,body:b?JSON.stringify(b):undefined}).then(r=>r.json());
const $=i=>document.getElementById(i);let apprId=null;
async function tick(){let s;try{s=await api('state')}catch{$('state').textContent='offline';return}
$('state').textContent=!s.enabled?'OFF':s.status.replace('_',' ');$('state').style.background=!s.enabled?'var(--bad)':s.status==='running'?'var(--ok)':s.status==='idle'?'#6b7c8e':'var(--warn)';
$('pause').hidden=!s.pause;if(s.pause)$('pausemsg').textContent=s.pause.reason;
$('appr').hidden=!s.pending;if(s.pending){$('what').textContent='['+s.pending.kind+'] '+s.pending.what;$('win').textContent=s.pending.window?'Window: '+s.pending.window:'';
if(apprId!==s.pending.id){apprId=s.pending.id;$('atext').value=s.pending.text||''}$('atext').hidden=!s.pending.text&&s.pending.kind!=='send'&&s.pending.kind!=='post'}else apprId=null;
$('now').textContent=s.current?('Step '+s.current.step+': '+s.current.text):'Idle';
if(s.current){$('shot').hidden=false;$('shot').src='/api/shot?t='+T+'&n='+Date.now()}else $('shot').hidden=true;
$('tasks').innerHTML=s.tasks.slice(-8).reverse().map(t=>'<div class="t"><div>'+esc(t.text)+'<div class="s">'+esc(t.result||'')+'</div></div><div class="s">'+t.status+'</div></div>').join('')||'<div class="s">No tasks yet.</div>';
$('log').textContent=s.log.map(l=>l.t+'  '+l.line).join('\\n');$('log').scrollTop=1e9}
const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
$('add').onclick=async()=>{const v=$('task').value.trim();if(!v)return;await api('task',{text:v});$('task').value='';tick()};
$('task').onkeydown=e=>{if(e.key==='Enter')$('add').click()};
$('stop').onclick=async()=>{await api('stop',{});tick()};$('resume').onclick=async()=>{await api('resume',{});tick()};
$('toggle').onclick=async()=>{await api('enabled',{});tick()};
$('yes').onclick=async()=>{await api('approve',{id:apprId,ok:true,text:$('atext').value});tick()};
$('no').onclick=async()=>{await api('approve',{id:apprId,ok:false});tick()};
tick();setInterval(tick,1500);
</script></body></html>`;
