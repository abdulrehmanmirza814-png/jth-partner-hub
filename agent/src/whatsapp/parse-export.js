// Parses WhatsApp "Export chat" .txt files (Android and iPhone formats).
const TIME = '(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[APap]\\.?[Mm]\\.?)?)';
const DATE = '(\\d{1,4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,4})';
const RE_ANDROID = new RegExp(`^${DATE},?\\s+${TIME}\\s+-\\s+([^:]+?):\\s?(.*)$`);
const RE_IOS = new RegExp(`^\\[${DATE},?\\s+${TIME}\\]\\s+([^:]+?):\\s?(.*)$`);
const MEDIA = /^(<media omitted>|<attached:.*>|(image|video|audio|sticker|document|gif|contact card|voice call|video call) omitted|.*\(file attached\)|null)$/i;
const INVISIBLE = /[‎‏‪-  ]/g;

export function parseDateTime(d, t) {
  const parts = d.split(/[/.\-]/).map(Number);
  let [a, b, c] = parts;
  let day = a, month = b, year = c;
  if (a > 31) { year = a; month = b; day = c; } // yyyy-mm-dd
  if (year < 100) year += 2000;
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap])?/.exec(t.replace(/\./g, ''));
  let h = Number(m[1]);
  if (m[4]) { const pm = m[4].toLowerCase() === 'p'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return Date.UTC(year, month - 1, day, h, Number(m[2]), Number(m[3] || 0)); // dd/mm assumed (UAE)
}

export function parseExport(text) {
  const msgs = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(INVISIBLE, ' ').replace(/^\s+/, '');
    const m = RE_IOS.exec(line) || RE_ANDROID.exec(line);
    if (m) {
      const [, d, t, sender, body] = m;
      msgs.push({ ts: parseDateTime(d, t), sender: sender.trim(), text: body.trim(), media: MEDIA.test(body.trim()) });
    } else if (msgs.length && line.trim() && !/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(line)) {
      msgs[msgs.length - 1].text += '\n' + line.trim();
    } // lines with a date but no sender are system notices (encryption, joined, etc.) -> ignored
  }
  return msgs.filter((m) => m.text);
}

export function senders(msgs) {
  return [...new Set(msgs.map((m) => m.sender))];
}

/** Merge consecutive messages from one sender (within 10 min) into turns. */
export function toTurns(msgs) {
  const turns = [];
  for (const m of msgs) {
    const last = turns.at(-1);
    if (last && last.sender === m.sender && (!(m.ts - last.end > 10 * 60 * 1000))) {
      last.text += (m.media || !m.text ? '' : '\n' + m.text);
      last.end = m.ts;
      last.media = last.media && m.media;
    } else turns.push({ sender: m.sender, text: m.text, start: m.ts, end: m.ts, media: m.media });
  }
  return turns;
}

/** Guest-turn -> owner-reply pairs for one 1:1 chat. */
export function buildPairs(msgs, owner, chat = '') {
  const turns = toTurns(msgs);
  const pairs = [];
  for (let i = 1; i < turns.length; i++) {
    const t = turns[i], prev = turns[i - 1];
    if (t.sender !== owner || prev.sender === owner || t.media || prev.media) continue;
    if (t.text.length < 2) continue;
    pairs.push({
      chat,
      customer: prev.text,
      reply: t.text,
      context: turns.slice(Math.max(0, i - 4), i - 1).map((x) => ({ from: x.sender === owner ? 'owner' : 'guest', text: x.text })),
    });
  }
  return pairs;
}

/** Pick the owner = the name that appears in the most chat files (or the configured one). */
export function detectOwner(chats, configured) {
  if (configured) return configured;
  const count = new Map();
  for (const c of chats) for (const s of senders(c.msgs)) count.set(s, (count.get(s) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
