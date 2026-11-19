import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { tempEnv, launch, fakeLLM } from './helpers.js';

const dataDir = tempEnv();
const { runTask, loadTaskState, BLOCK_SIGNALS } = await import('../src/web/agent.js');
const { parseTask, isDue } = await import('../src/web/tasks.js');

const FEED = (n) => `<!doctype html><title>Dubai Tours</title><body><h1>Dubai Tours page</h1>
${[1, 2, 3].map((i) => `<div class="post"><p>Post ${i}: amazing desert safari photos</p><a href="/post/${i}">Post ${i} link</a>
<textarea placeholder="Write a comment..." id="c${i}"></textarea><button onclick="">Like</button><ul id="list${i}"></ul></div>`).join('')}
<a href="http://localhost:${n}/">Elsewhere</a>
<script>document.querySelectorAll('textarea').forEach(t=>t.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();
fetch('/comment',{method:'POST',body:t.value});const li=document.createElement('li');li.textContent=t.value;t.nextElementSibling.nextElementSibling.appendChild(li);t.value='';}}))</script></body>`;
let server, port, browser, context;
const received = []; // what the mock site actually received from the browser
before(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { received.push(b); res.end('ok'); }); return; }
    res.setHeader('content-type', 'text/html');
    if (req.url.startsWith('/blocked')) return res.end('<h1>You’re temporarily blocked</h1><p>We limit how often you can do this.</p>');
    res.end(FEED(port));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  ({ browser, context } = await launch());
});
after(async () => { await browser.close(); server.close(); });

const base = () => `http://127.0.0.1:${port}`;
const task = (over = {}) => ({ ...parseTask(`---\nname: ${over.name || 't' + Math.random().toString(36).slice(2, 7)}\n---\nComment on posts.`), start_url: base() + '/', allowed_domains: ['127.0.0.1'], max_steps: 12, approval: 'auto', max_publishes_per_run: 5, max_publishes_per_day: 10, ...over });
/** Pull the element number out of the observation text the model is shown. */
const idOf = (params, re) => Number(new RegExp(`\\[(\\d+)\\] ${re}`).exec(params.messages[0].content[0].text)?.[1]);
const commentBox = (p) => idOf(p, `textarea \\(text box\\) "Write a comment\\.\\.\\."`);

async function comments(page) { return page.$$eval('li', (l) => l.map((x) => x.textContent)); }

test('publishes a unique comment, refuses duplicates/identical text/over-cap, and records everything', async () => {
  let seen;
  const script = [
    (p) => ({ action: 'check_done', dedupe_key: 'post-1', memo: 'checking' }),
    (p) => ({ action: 'submit_text', id: commentBox(p), text: 'Gorgeous shots! Planning a desert safari? JTH Tourism does hotel pickups.', dedupe_key: 'post-1', memo: 'commented' }),
    (p) => ({ action: 'submit_text', id: commentBox(p), text: 'Another comment on the same post', dedupe_key: 'post-1', memo: 'dup key' }),
    (p) => ({ action: 'submit_text', id: commentBox(p), text: 'Gorgeous shots! Planning a desert safari? JTH Tourism does hotel pickups.', dedupe_key: 'post-2', memo: 'identical text' }),
    (p) => ({ action: 'submit_text', id: commentBox(p), text: 'Love this one too, great atmosphere.', dedupe_key: 'post-2', memo: 'over cap' }),
    (p) => ({ action: 'done', summary: 'finished', memo: 'end' }),
  ];
  let i = 0;
  const llm = fakeLLM((p) => { seen = p; return script[i++](p); });
  const t = task({ max_publishes_per_run: 1 });
  const r = await runTask(t, { llm, context, gap: [0, 0] });
  assert.equal(r.status, 'finished', JSON.stringify(r));
  assert.equal(r.publishes, 1, r.log.join("\n"));
  const log = r.log.join('\n');
  assert.match(log, /PUBLISHED on post-1/);
  assert.match(log, /REFUSED: already done/);
  assert.match(log, /REFUSED: identical text/);
  assert.match(log, /REFUSED: per-run publish limit/);
  const st = loadTaskState(t.name);
  assert.equal(st.publishes[new Date().toISOString().slice(0, 10)], 1);
  assert.match(fs.readFileSync(path.join(dataDir, 'published.md'), 'utf8'), /Gorgeous shots/);
  assert.match(seen.system, /submit_text/);
  assert.deepEqual(received, ['Gorgeous shots! Planning a desert safari? JTH Tourism does hotel pickups.']); // exactly one real post
});

test('the comment really lands on the page', async () => {
  const t = task({ name: 'lands' });
  let step = 0;
  const llm = fakeLLM((p) => (step++ === 0
    ? { action: 'submit_text', id: commentBox(p), text: 'Beautiful! Visit us for Dubai tours.', dedupe_key: 'p-lands', memo: 'x' }
    : { action: 'done', summary: 'ok', memo: 'x' }));
  const before = received.length;
  const r = await runTask(t, { llm, context, gap: [0, 0] });
  assert.equal(r.publishes, 1);
  assert.deepEqual(received.slice(before), ['Beautiful! Visit us for Dubai tours.']);
  assert.ok(loadTaskState('lands').done['p-lands']);
});

test('daily cap persists across runs', async () => {
  const t = task({ name: 'daily', max_publishes_per_day: 1 });
  const mkLLM = (key) => { let s = 0; return fakeLLM((p) => (s++ === 0 ? { action: 'submit_text', id: commentBox(p), text: `Nice ${key}!`, dedupe_key: key, memo: 'x' } : { action: 'done', summary: 'x', memo: 'x' })); };
  assert.equal((await runTask(t, { llm: mkLLM('a'), context, gap: [0, 0] })).publishes, 1);
  const r2 = await runTask(t, { llm: mkLLM('b'), context, gap: [0, 0] });
  assert.equal(r2.publishes, 0);
  assert.match(r2.log.join('\n'), /daily publish limit/);
});

test('ask mode: declined text is not posted; dry run never posts', async () => {
  const t1 = task({ name: 'ask', approval: 'ask' });
  const one = () => { let s = 0; return fakeLLM((p) => (s++ === 0 ? { action: 'submit_text', id: commentBox(p), text: 'Hello from JTH!', dedupe_key: 'k', memo: 'x' } : { action: 'done', summary: 'x', memo: 'x' })); };
  const r1 = await runTask(t1, { llm: one(), context, approve: async () => ({ ok: false }), gap: [0, 0] });
  assert.equal(r1.publishes, 0);
  assert.match(r1.log.join('\n'), /did not approve/);
  assert.equal(received.includes('Hello from JTH!'), false); // declined -> nothing reached the site
  const r2 = await runTask(task({ name: 'dry' }), { llm: one(), context, dry: true, gap: [0, 0] });
  assert.equal(received.includes('Hello from JTH!'), false); // dry run -> nothing reached the site
  assert.equal(r2.publishes, 0);
  assert.match(r2.log.join('\n'), /DRY RUN/);
  assert.match(fs.readFileSync(path.join(dataDir, 'proposed-posts.md'), 'utf8'), /Hello from JTH!/);
  const r3 = await runTask(task({ name: 'edit', approval: 'ask' }), { llm: one(), context, approve: async () => ({ ok: true, text: 'Edited by Abdul' }), gap: [0, 0] });
  assert.equal(r3.publishes, 1);
  assert.match(fs.readFileSync(path.join(dataDir, 'published.md'), 'utf8'), /Edited by Abdul/);
  assert.equal(received.at(-1), 'Edited by Abdul'); // the edited text is what was really posted
});

test('refuses off-domain goto and direct clicks on Post/Send buttons', async () => {
  const t = task({ name: 'guard' });
  const script = [
    () => ({ action: 'goto', url: 'https://evil.example.com/', memo: 'x' }),
    () => ({ action: 'goto', url: `http://localhost:${port}/`, memo: 'x' }),
    () => ({ action: 'done', summary: 'x', memo: 'x' }),
  ];
  let i = 0;
  const r = await runTask(t, { llm: fakeLLM(() => script[i++]()), context, gap: [0, 0] });
  assert.equal(r.log.filter((l) => /REFUSED \(domain not allowed\)/.test(l)).length, 2);
  assert.equal(r.publishes, 0);
});

test('stops immediately on a site warning to protect the account', async () => {
  const llm = fakeLLM(() => ({ action: 'done', summary: 'x', memo: 'x' }));
  const r = await runTask(task({ name: 'blocked', start_url: base() + '/blocked' }), { llm, context, gap: [0, 0] });
  assert.equal(r.status, 'blocked');
  assert.equal(llm.calls.length, 0);
  assert.match(fs.readFileSync(path.join(dataDir, 'owner-alerts.md'), 'utf8'), /Task stopped: blocked/);
});

test('step limit, ask_owner and model errors end the run cleanly', async () => {
  const r1 = await runTask(task({ name: 's1', max_steps: 3 }), { llm: fakeLLM(() => ({ action: 'scroll', direction: 'down', memo: 'x' })), context, gap: [0, 0] });
  assert.equal(r1.status, 'step_limit');
  const r2 = await runTask(task({ name: 's2' }), { llm: fakeLLM(() => ({ action: 'ask_owner', question: 'Login needed', memo: 'x' })), context, gap: [0, 0] });
  assert.equal(r2.status, 'needs_owner');
  const r3 = await runTask(task({ name: 's3' }), { llm: fakeLLM(() => null), context, gap: [0, 0] });
  assert.equal(r3.status, 'error');
});

test('task file parsing and scheduling', () => {
  const t = parseTask('---\nname: fb\nschedule: every 6h\nallowed_domains: facebook.com, www.facebook.com\nmax_publishes_per_day: 7\napproval: auto\nvision: true\n---\nDo the thing.');
  assert.deepEqual([t.name, t.max_publishes_per_day, t.approval, t.vision, t.allowed_domains.length], ['fb', 7, 'auto', true, 2]);
  assert.equal(parseTask('Just text').approval, 'ask');
  const now = new Date('2026-01-01T12:00:00');
  assert.equal(isDue('every 6h', new Date(now - 7 * 3600e3).toISOString(), now), true);
  assert.equal(isDue('every 6h', new Date(now - 1 * 3600e3).toISOString(), now), false);
  assert.equal(isDue('daily 10:00', undefined, now), true);
  assert.equal(isDue('daily 10:00', new Date('2026-01-01T10:30:00').toISOString(), now), false);
  assert.equal(isDue('manual', undefined, now), false);
  assert.ok(BLOCK_SIGNALS.test("You're temporarily blocked") && !BLOCK_SIGNALS.test('Desert safari photos'));
});
