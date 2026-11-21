import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA } from '../util.js';
import { pageHtml } from './page.js';
import { addTask, listTasks } from '../desktop/tasks.js';

const TOKEN_FILE = () => path.join(DATA, 'secrets', 'panel-token');
export function panelToken() {
  try { return fs.readFileSync(TOKEN_FILE(), 'utf8').trim(); } catch { /* create below */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(TOKEN_FILE()), { recursive: true });
  fs.writeFileSync(TOKEN_FILE(), t, { mode: 0o600 });
  return t;
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/**
 * Local control panel. Security: bound to 127.0.0.1 only, the Host header must be local (blocks DNS
 * rebinding), and every request needs the secret token (blocks other websites from commanding it).
 */
export async function startPanel({ control, port = 8787, token = panelToken() }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...(code === 413 ? { connection: 'close' } : {}) }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    try {
      const host = (req.headers.host || '').toLowerCase();
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(403, { error: 'bad host' });
      const u = new URL(req.url, 'http://local');
      const given = req.headers['x-panel-token'] || u.searchParams.get('t') || '';
      if (!same(given, token)) return send(403, { error: 'forbidden' });
      if (req.method === 'GET' && u.pathname === '/') return send(200, pageHtml(token), 'text/html; charset=utf-8');
      if (req.method === 'GET' && u.pathname === '/api/state') {
        return send(200, { enabled: control.enabled, status: control.status, current: control.current, pause: control.pauseInfo, pending: control.pending, log: control.logLines.slice(-80), tasks: listTasks() });
      }
      if (req.method === 'GET' && u.pathname === '/api/shot') {
        if (!control.shotPath || !fs.existsSync(control.shotPath)) return send(404, { error: 'none' });
        return send(200, fs.readFileSync(control.shotPath), 'image/jpeg');
      }
      if (req.method === 'POST') {
        let raw = '';
        for await (const c of req) { raw += c; if (raw.length > 100000) return send(413, { error: 'too large' }); }
        const body = raw ? JSON.parse(raw) : {};
        switch (u.pathname) {
          case '/api/task': { const t = addTask(String(body.text || ''), 'panel'); control.enabled = true; return send(200, t); }
          case '/api/stop': control.stop('Stopped from the control panel'); return send(200, { ok: true });
          case '/api/resume': control.resume(); return send(200, { ok: true });
          case '/api/enabled': control.enabled = !control.enabled; if (control.enabled) control.clearStop(); return send(200, { enabled: control.enabled });
          case '/api/approve': return send(200, { ok: control.resolveApproval(String(body.id), !!body.ok, body.text ? String(body.text) : undefined) });
        }
      }
      return send(404, { error: 'not found' });
    } catch (e) { return send(500, { error: String(e.message) }); }
  });
  let p = port;
  for (;;) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, '127.0.0.1', () => { server.off('error', reject); resolve(); }); }); break; }
    catch (e) { if (e.code === 'EADDRINUSE' && p < port + 20) p++; else throw e; }
  }
  const actual = server.address().port;
  return { server, port: actual, token, url: `http://127.0.0.1:${actual}/?t=${token}`, close: () => new Promise((r) => server.close(r)) };
}
