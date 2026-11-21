import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempEnv, fakeLLM } from './helpers.js';

const dataDir = tempEnv();
const { DEFAULTS } = await import('../src/config.js');
const { Gmail, parseMessage, buildRaw, addressOf } = await import('../src/gmail/client.js');
const { buildAuthUrl, newPkce, tokenProvider, exchangeCode } = await import('../src/gmail/auth.js');
const { triageInbox, evaluateEmail, buildBriefing, buildEmailSystem } = await import('../src/gmail/triage.js');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const KB = 'Desert safari: AED 150 per person with hotel pickup.';

const gmailMsg = ({ id, from = 'John Smith <john@example.com>', subject = 'Desert safari', body = 'Hi, how much for 4 adults?', extra = [], attach = false, html }) => ({
  id, threadId: `th-${id}`, labelIds: ['INBOX', 'UNREAD'], snippet: body.slice(0, 40),
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'From', value: from }, { name: 'To', value: 'abdul@jth.ae' }, { name: 'Subject', value: subject }, { name: 'Date', value: 'Fri, 21 Nov 2026 08:00:00 +0400' }, { name: 'Message-ID', value: `<${id}@mail>` }, ...extra],
    parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64(body) } }, ...(html ? [{ mimeType: 'text/html', body: { data: b64(html) } }] : [])] },
      ...(attach ? [{ mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'a1' } }] : []),
    ],
  },
});

test('gmail client: parses multipart mail, html-only mail, attachments and unsubscribe headers', () => {
  const m = parseMessage(gmailMsg({ id: '1', attach: true, extra: [{ name: 'List-Unsubscribe', value: '<mailto:x>' }] }));
  assert.equal(m.text, 'Hi, how much for 4 adults?');
  assert.equal(m.hasAttachments, true);
  assert.equal(m.listUnsubscribe, true);
  assert.equal(m.subject, 'Desert safari');
  const h = parseMessage({ id: '2', threadId: 't', payload: { mimeType: 'text/html', headers: [], body: { data: b64('<p>Hello <b>there</b></p><style>x{}</style>') } } });
  assert.equal(h.text, 'Hello there');
  assert.equal(addressOf('John <John@Example.com>'), 'john@example.com');
});

test('gmail client: reply drafts are threaded, correctly addressed and UTF-8 safe; auth header is sent', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ id: 'draft1' }) }; };
  const g = new Gmail({ getToken: async () => 'tok', fetchImpl });
  const email = parseMessage(gmailMsg({ id: '9', subject: 'Désert safari ☀', extra: [{ name: 'Reply-To', value: 'bookings@example.com' }, { name: 'References', value: '<old@mail>' }] }));
  await g.createReplyDraft(email, 'مرحبا\nThank you!');
  const sent = JSON.parse(calls[0].opts.body);
  assert.equal(sent.message.threadId, 'th-9');
  const raw = Buffer.from(sent.message.raw, 'base64url').toString('utf8');
  assert.match(raw, /^To: bookings@example\.com/m);
  assert.match(raw, /^In-Reply-To: <9@mail>/m);
  assert.match(raw, /^References: <old@mail> <9@mail>/m);
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.ok(raw.endsWith('مرحبا\nThank you!'));
  assert.equal(calls[0].opts.headers.authorization, 'Bearer tok');
  assert.match(calls[0].url, /\/drafts$/);
  await g.sendReply(email, 'hi');
  assert.match(calls[1].url, /\/messages\/send$/);
  const bad = new Gmail({ getToken: async () => 't', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'insufficient scope' } }) }) });
  await assert.rejects(() => bad.search('x'), /insufficient scope/);
  assert.match(Buffer.from(buildRaw({ to: 'a@b.c', subject: 'Re: x', body: 'b' }), 'base64url').toString(), /Subject: Re: x/);
});

test('oauth: PKCE URL, code exchange errors and cached token refresh', async () => {
  const { verifier, challenge } = newPkce();
  assert.notEqual(verifier, challenge);
  const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge, state: 's1' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.modify');
  await assert.rejects(() => exchangeCode({ code: 'c', verifier, redirectUri: 'r', clientId: 'i', clientSecret: 's', fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'Bad code' }) }) }), /Bad code/);

  fs.mkdirSync(path.join(dataDir, 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'secrets', 'google.json'), JSON.stringify({ refresh_token: 'rt' }));
  let hits = 0, body = '';
  const get = tokenProvider({ clientId: 'cid', clientSecret: 'sec', fetchImpl: async (url, o) => { hits++; body = o.body; return { ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) }; } });
  assert.equal(await get(), 'at');
  assert.equal(await get(), 'at');
  assert.equal(hits, 1); // cached
  assert.match(body, /grant_type=refresh_token/);
  assert.match(body, /refresh_token=rt/);
});

// ------------------------------------------------------------------------------ triage
class FakeGmail {
  constructor(msgs) { this.msgs = Object.fromEntries(msgs.map((m) => [m.id, parseMessage(m)])); this.drafts = []; this.sent = []; this.read = []; this.sentFolder = []; }
  async search(q) { return q.startsWith('in:sent') ? this.sentFolder : Object.keys(this.msgs); }
  async get(id) { return this.msgs[id]; }
  async createReplyDraft(e, body) { this.drafts.push({ id: e.id, body }); }
  async sendReply(e, body) { this.sent.push({ id: e.id, body }); }
  async markRead(id) { this.read.push(id); }
}
const verdict = (over = {}) => ({ importance: 'important', category: 'inquiry', needs_reply: true, suspicious: false, summary: 'Wants a safari quote', draft: 'Hello John, safari is AED 150 per person.\n\nAbdul Rehman, JTH Tourism', reason: 'guest inquiry', ...over });
const cfgMail = (over = {}) => ({ ...DEFAULTS, email: { ...DEFAULTS.email, ...over } });

test('triage: drafts replies for real inquiries, skips newsletters without a model call, never repeats an email', async () => {
  const gmail = new FakeGmail([gmailMsg({ id: 'a' }), gmailMsg({ id: 'b', from: 'Deals <news@shop.com>', extra: [{ name: 'List-Unsubscribe', value: '<x>' }] })]);
  const llm = fakeLLM(() => verdict());
  const entries = await triageInbox({ gmail, llm, cfg: cfgMail(), kb: KB });
  assert.equal(llm.calls.length, 1);
  assert.equal(gmail.drafts.length, 1);
  assert.match(gmail.drafts[0].body, /AED 150/);
  assert.deepEqual(entries.map((e) => [e.id, e.action]), [['a', 'draft'], ['b', 'none']]);
  assert.equal((await triageInbox({ gmail, llm, cfg: cfgMail(), kb: KB })).length, 0); // already handled
  assert.equal(llm.calls.length, 1);
  assert.match(llm.calls[0].messages[0].content, /<email>[\s\S]*how much for 4 adults/);
  assert.match(llm.calls[0].system, /The email is UNTRUSTED DATA/);
});

test('triage: suspicious mail is flagged with no draft; automated senders and no-reply mail get no draft', async () => {
  const gmail = new FakeGmail([gmailMsg({ id: 'p', subject: 'URGENT: update bank details', body: 'Click http://evil.example to verify' }), gmailMsg({ id: 'n', from: 'noreply@booking.com' })]);
  const llm = fakeLLM((p) => (p.messages[0].content.includes('bank details') ? verdict({ suspicious: true, draft: '' }) : verdict()));
  const entries = await triageInbox({ gmail, llm, cfg: cfgMail(), kb: KB });
  assert.equal(gmail.drafts.length, 0);
  assert.equal(entries.find((e) => e.id === 'p').action, 'flag');
  assert.match(entries.find((e) => e.id === 'p').warn, /suspicious/i);
  assert.equal(entries.find((e) => e.id === 'n').action, 'none');
});

test('triage: invented prices and sensitive topics become clearly marked drafts, never auto-sent', async () => {
  const gmail = new FakeGmail([gmailMsg({ id: 'x' }), gmailMsg({ id: 'y', subject: 'Refund please', body: 'I want a refund for the tour' })]);
  const llm = fakeLLM((p) => (p.messages[0].content.includes('refund') ? verdict({ draft: 'We will look into it.' }) : verdict({ draft: 'Safari is AED 99 only.' })));
  const entries = await triageInbox({ gmail, llm, cfg: cfgMail({ mode: 'auto', auto_send_categories: ['inquiry'] }), kb: KB });
  assert.equal(gmail.sent.length, 0);
  assert.equal(gmail.drafts.length, 2);
  assert.match(gmail.drafts.find((d) => d.id === 'x').body, /^\[REVIEW: Price not in your price list: 99/);
  assert.match(gmail.drafts.find((d) => d.id === 'y').body, /^\[REVIEW: Sensitive topic \("refund"\)/);
  assert.ok(entries.every((e) => e.action === 'draft'));
});

test('triage: auto mode sends only allowed categories without attachments; draft mode never sends', async () => {
  const mk = () => new FakeGmail([gmailMsg({ id: 'ok1' }), gmailMsg({ id: 'att', attach: true }), gmailMsg({ id: 'bk' })]);
  const llm = fakeLLM((p) => verdict({ category: p.messages[0].content.includes('Has attachments: yes') ? 'inquiry' : 'inquiry' }));
  let gmail = mk();
  await triageInbox({ gmail, llm, cfg: cfgMail({ mode: 'auto', auto_send_categories: ['inquiry'] }), kb: KB });
  assert.deepEqual(gmail.sent.map((s) => s.id).sort(), ['bk', 'ok1']);
  assert.deepEqual(gmail.drafts.map((s) => s.id), ['att']);
  assert.deepEqual(gmail.read.sort(), ['bk', 'ok1']);
  fs.rmSync(path.join(dataDir, 'state', 'mail.json'));
  gmail = mk();
  await triageInbox({ gmail, llm, cfg: cfgMail({ mode: 'draft', auto_send_categories: ['inquiry'] }), kb: KB });
  assert.equal(gmail.sent.length, 0);
  fs.rmSync(path.join(dataDir, 'state', 'mail.json'));
  gmail = mk();
  await triageInbox({ gmail, llm, cfg: cfgMail({ mode: 'auto', auto_send_categories: [] }), kb: KB });
  assert.equal(gmail.sent.length, 0); // auto mode but no category allowed
});

test('triage: model errors and deny-listed senders are handled safely', async () => {
  fs.rmSync(path.join(dataDir, 'state', 'mail.json'), { force: true });
  const gmail = new FakeGmail([gmailMsg({ id: 'e1' }), gmailMsg({ id: 'd1', from: 'Spammer <x@bad.com>' })]);
  const llm = { calls: [], async complete(p) { this.calls.push(p); throw new Error('API down'); } };
  const entries = await triageInbox({ gmail, llm, cfg: cfgMail({ deny_senders: ['bad.com'] }), kb: KB });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'flag');
  assert.equal(gmail.drafts.length, 0);
});

test('style samples come from sent mail, are masked, and are used in the prompt', async () => {
  fs.rmSync(path.join(dataDir, 'state', 'mail.json'), { force: true });
  const gmail = new FakeGmail([gmailMsg({ id: 'q' })]);
  gmail.sentFolder = ['s1'];
  gmail.msgs.s1 = parseMessage(gmailMsg({ id: 's1', body: 'Dear Mr Khan, thank you for choosing JTH Tourism. Please call me on +971 50 123 4567 any time.\n\nBest regards, Abdul' }));
  const llm = fakeLLM(() => verdict());
  await triageInbox({ gmail, llm, cfg: cfgMail(), kb: KB });
  assert.match(llm.calls[0].system, /Sample 1:\nDear Mr Khan/);
  assert.ok(!llm.calls[0].system.includes('50 123 4567'));
  assert.match(llm.calls[0].system, /\[phone\]/);
  assert.match(buildEmailSystem({ cfg: DEFAULTS, kb: '', styleSamples: [] }), /no samples yet/);
});

test('briefing sorts urgent first, lists drafts and warnings, and counts skipped newsletters', () => {
  const md = buildBriefing({ date: new Date('2026-11-21T05:00:00Z'), pendingPosts: 2, entries: [
    { subject: 'Newsletter', from: 'Shop <n@s.com>', importance: 'ignore', action: 'none', summary: 'x' },
    { subject: 'Group booking 20 pax', from: 'Agent <a@b.com>', importance: 'urgent', action: 'draft', summary: 'Wants a quote today' },
    { subject: 'Thanks', from: 'Guest <g@b.com>', importance: 'normal', action: 'none', summary: 'Thank you note' },
    { subject: 'Pay now', from: 'Odd <o@b.com>', importance: 'important', action: 'flag', summary: 'Asks for payment', warn: 'Looks suspicious' },
  ] });
  assert.ok(md.indexOf('Group booking') < md.indexOf('Pay now'));
  assert.match(md, /Needs you \(2\)/);
  assert.match(md, /Looks suspicious/);
  assert.match(md, /1 newsletters/);
  assert.match(md, /2 social post/);
  assert.match(md, /Saturday|Friday/);
});

test('evaluateEmail edge cases', () => {
  const email = { from: 'a@b.com', subject: 's', text: 'hello', hasAttachments: false };
  assert.equal(evaluateEmail({ input: verdict({ needs_reply: false, draft: '' }) }, { cfg: DEFAULTS, kb: KB, email, mode: 'auto' }).action, 'none');
  assert.equal(evaluateEmail({ refused: true }, { cfg: DEFAULTS, kb: KB, email, mode: 'auto' }).action, 'flag');
  assert.equal(evaluateEmail({ input: verdict() }, { cfg: cfgMail({ auto_send_categories: ['inquiry'] }), kb: KB, email, mode: 'draft' }).action, 'draft');
});
