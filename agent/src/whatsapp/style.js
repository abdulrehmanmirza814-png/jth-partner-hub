import { scrub } from '../privacy.js';

const tok = (s) => (String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);
const EMOJI = /\p{Extended_Pictographic}/u;

/** TF-IDF index over the guest side of past exchanges, used to find similar past situations. */
export function buildIndex(pairs) {
  const docs = pairs.map((p) => tok(p.customer));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
  const N = Math.max(1, docs.length);
  const idf = (w) => Math.log(1 + N / (1 + (df.get(w) || 0)));
  const vec = (words) => {
    const tf = new Map();
    for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [w, c] of tf) { const x = (1 + Math.log(c)) * idf(w); v.set(w, x); norm += x * x; }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  };
  return { pairs, vectors: docs.map(vec), vec };
}

export function retrieve(index, query, k = 6) {
  if (!index.pairs.length) return [];
  const q = index.vec(tok(query));
  const scored = index.vectors.map((v, i) => {
    let s = 0;
    for (const [w, x] of q) s += x * (v.get(w) || 0);
    return { i, s };
  }).filter((x) => x.s > 0.12).sort((a, b) => b.s - a.s);
  const out = [], seen = new Set();
  for (const { i } of scored) {
    const key = index.pairs[i].reply.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue; // avoid showing near-identical replies repeatedly
    seen.add(key);
    out.push(index.pairs[i]);
    if (out.length >= k) break;
  }
  return out;
}

export function formatExamples(examples) {
  return examples.map((p, n) => `Example ${n + 1}\nGuest: ${scrub(p.customer)}\nAbdul: ${scrub(p.reply)}`).join('\n\n');
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

/** Plain statistics about how the owner writes. Cheap, no API call. */
export function styleStats(pairs) {
  if (!pairs.length) return null;
  const replies = pairs.map((p) => p.reply);
  const words = replies.map((r) => r.split(/\s+/).filter(Boolean).length);
  const openings = new Map(), closings = new Map();
  for (const r of replies) {
    const w = r.trim().split(/\s+/);
    const o = w.slice(0, 2).join(' ').toLowerCase().replace(/[,.!]+$/, '');
    const c = w.slice(-4).join(' ').toLowerCase();
    openings.set(o, (openings.get(o) || 0) + 1);
    closings.set(c, (closings.get(c) || 0) + 1);
  }
  const top = (m) => [...m.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `"${t}" (${n}x)`);
  const pct = (f) => Math.round((100 * replies.filter(f).length) / replies.length);
  return {
    sample: pairs.length,
    medianWords: median(words),
    p90Words: [...words].sort((a, b) => a - b)[Math.floor(words.length * 0.9)] || 0,
    emojiPct: pct((r) => EMOJI.test(r)),
    exclaimPct: pct((r) => r.includes('!')),
    lowercaseStartPct: pct((r) => /^[a-z]/.test(r.trim())),
    multiLinePct: pct((r) => r.includes('\n')),
    commonOpenings: top(openings),
    commonClosings: top(closings),
  };
}

export function statsToText(s) {
  if (!s) return '';
  return [
    `Measured from ${s.sample} of Abdul's real replies:`,
    `- Typical reply length: ~${s.medianWords} words (90% are under ${s.p90Words}).`,
    `- ${s.emojiPct}% of replies contain an emoji; ${s.exclaimPct}% contain "!"; ${s.multiLinePct}% are multi-line.`,
    s.commonOpenings.length ? `- Common openings: ${s.commonOpenings.join(', ')}` : '',
    s.commonClosings.length ? `- Common closings: ${s.commonClosings.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
