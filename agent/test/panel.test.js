import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempEnv } from './helpers.js';

tempEnv();
const { startPanel } = await import('../src/panel/server.js');
const { Control } = await import('../src/desktop/control.js');
const { listTasks } = await import('../src/desktop/tasks.js');

const control = new Control();
let panel;
before(async () => { panel = await startPanel({ control, port: 0, token: 'secret-token' }); });
after(async () => { await panel.close(); });

const req = (path, { method = 'GET', token = 'secret-token', host, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ agent: false, host: '127.0.0.1', port: panel.port, path, method, headers: { ...(token ? { 'x-panel-token': token } : {}), host: host || `127.0.0.1:${panel.port}`, 'content-type': 'application/json' } }, (res) => {
    let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, text: d, json: () => JSON.parse(d) }));
  });
  r.on('error', reject);
  if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
  r.end();
});

test('requests without the secret token, or with a foreign Host header, are rejected', async () => {
  assert.equal((await req('/api/state', { token: '' })).status, 403);
  assert.equal((await req('/api/state', { token: 'wrong' })).status, 403);
  assert.equal((await req('/api/state', { host: 'evil.example.com' })).status, 403); // DNS-rebinding style
  assert.equal((await req('/api/task', { method: 'POST', token: '', body: { text: 'x' } })).status, 403);
  assert.equal((await req('/api/state')).status, 200);
});

test('the page is served only with the token and the token is embedded for its own API calls', async () => {
  assert.equal((await req('/', { token: '' })).status, 403);
  const r = await req('/?t=secret-token', { token: '' });
  assert.equal(r.status, 200);
  assert.match(r.text, /JTH Assistant/);
  assert.match(r.text, /secret-token/);
});

test('submitting a task queues it and switches the assistant on', async () => {
  control.enabled = false;
  const r = await req('/api/task', { method: 'POST', body: { text: 'Check my Gmail' } });
  assert.equal(r.status, 200);
  assert.equal(control.enabled, true);
  assert.equal(listTasks().at(-1).text, 'Check my Gmail');
  assert.equal((await req('/api/task', { method: 'POST', body: { text: '   ' } })).status, 500); // empty task refused
});

test('approval round trip through the panel, including an edited text', async () => {
  const waiting = control.requestApproval({ kind: 'send', what: 'Send reply', text: 'Hello John' });
  const state = (await req('/api/state')).json();
  assert.equal(state.status, 'waiting_approval');
  assert.equal(state.pending.text, 'Hello John');
  const ok = await req('/api/approve', { method: 'POST', body: { id: state.pending.id, ok: true, text: 'Hello John, welcome!' } });
  assert.equal(ok.json().ok, true);
  assert.deepEqual(await waiting, { ok: true, text: 'Hello John, welcome!' });
  assert.equal((await req('/api/approve', { method: 'POST', body: { id: 'nope', ok: true } })).json().ok, false); // stale id does nothing
});

test('STOP declines a waiting approval, ends the run and switches the assistant off', async () => {
  const waiting = control.requestApproval({ kind: 'post', what: 'Post it', text: 'x' });
  await req('/api/stop', { method: 'POST', body: {} });
  assert.deepEqual(await waiting, { ok: false, text: undefined });
  assert.equal(control.stopFlag, true);
  assert.equal(control.enabled, false);
  const t = await req('/api/enabled', { method: 'POST', body: {} });
  assert.equal(t.json().enabled, true);
  assert.equal(control.stopFlag, false); // turning back on clears the stop
});

test('oversized bodies and unknown routes are refused', async () => {
  const before = listTasks().length;
  const big = await req('/api/task', { method: 'POST', body: 'x'.repeat(200000) }).then((r) => r.status, (e) => e.code); // 413, or the connection is cut while uploading
  assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(big), String(big));
  assert.equal(listTasks().length, before); // nothing was queued
  assert.equal((await req('/api/nothing')).status, 404);
});
