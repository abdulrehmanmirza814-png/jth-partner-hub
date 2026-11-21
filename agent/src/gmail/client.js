const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const fromB64 = (s) => Buffer.from(s || '', 'base64url').toString('utf8');

export const addressOf = (h = '') => (/<([^>]+)>/.exec(h)?.[1] || h).trim().toLowerCase();
const encSubject = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const stripHtml = (h) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

export function buildRaw({ to, subject, body, inReplyTo, references }) {
  const lines = [`To: ${to}`, `Subject: ${encSubject(subject)}`];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${references || inReplyTo}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '', body);
  return b64url(lines.join('\r\n'));
}

function collectText(part, out = { plain: '', html: '', attach: false }) {
  if (!part) return out;
  if (part.filename) out.attach = true;
  if (part.mimeType === 'text/plain' && part.body?.data && !part.filename) out.plain += fromB64(part.body.data);
  else if (part.mimeType === 'text/html' && part.body?.data && !part.filename) out.html += fromB64(part.body.data);
  (part.parts || []).forEach((p) => collectText(p, out));
  return out;
}

export function parseMessage(m) {
  const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  const t = collectText(m.payload);
  const text = (t.plain || stripHtml(t.html) || m.snippet || '').trim();
  return {
    id: m.id, threadId: m.threadId, labels: m.labelIds || [],
    from: h.from || '', to: h.to || '', subject: h.subject || '(no subject)', date: h.date || '',
    replyTo: h['reply-to'] || h.from || '', messageId: h['message-id'] || '', references: h.references || '',
    listUnsubscribe: !!h['list-unsubscribe'], text, hasAttachments: t.attach,
  };
}

export class Gmail {
  constructor({ getToken, fetchImpl = fetch }) { Object.assign(this, { getToken, fetchImpl }); }

  async call(path, { method = 'GET', body } = {}) {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.getToken()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gmail ${method} ${path.split('?')[0]} failed: ${data.error?.message || res.status}`);
    return data;
  }

  async search(q, max = 20) {
    const r = await this.call(`/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
    return (r.messages || []).map((m) => m.id);
  }
  async get(id) { return parseMessage(await this.call(`/messages/${id}?format=full`)); }

  /** Creates a draft in the same thread. It sits in Gmail > Drafts until you send it. */
  async createReplyDraft(email, body) {
    const raw = buildRaw({ to: email.replyTo || email.from, subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`, body, inReplyTo: email.messageId, references: `${email.references} ${email.messageId}`.trim() });
    return this.call('/drafts', { method: 'POST', body: { message: { raw, threadId: email.threadId } } });
  }
  async sendReply(email, body) {
    const raw = buildRaw({ to: email.replyTo || email.from, subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`, body, inReplyTo: email.messageId, references: `${email.references} ${email.messageId}`.trim() });
    return this.call('/messages/send', { method: 'POST', body: { raw, threadId: email.threadId } });
  }
  async markRead(id) { return this.call(`/messages/${id}/modify`, { method: 'POST', body: { removeLabelIds: ['UNREAD'] } }); }
}
