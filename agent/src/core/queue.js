// A small approval queue. Anything that goes out to the public (social posts) waits here until
// the owner approves it with `npm run review`. Items are plain JSON in data/state/queue.json.
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, readJson, writeJson, log } from '../util.js';

const FILE = () => path.join(DATA, 'state', 'queue.json');
const load = () => readJson(FILE(), { items: [] });
const save = (q) => writeJson(FILE(), q);

/** status: pending -> approved -> done | failed ; or rejected ; or needs_image */
export function add({ type, title, preview, payload = {}, scheduled_at = null }) {
  const q = load();
  const item = { id: crypto.randomUUID().slice(0, 8), type, title, preview, payload, scheduled_at, status: 'pending', created: new Date().toISOString() };
  q.items.push(item);
  save(q);
  return item;
}
export const list = (status) => load().items.filter((i) => !status || i.status === status);
export const get = (id) => load().items.find((i) => i.id === id);
export function update(id, patch) {
  const q = load();
  const item = q.items.find((i) => i.id === id);
  if (!item) throw new Error(`no queue item ${id}`);
  Object.assign(item, patch);
  save(q);
  return item;
}

/**
 * Execute approved items that are due. `executors` maps item.type -> async (item) => resultText.
 * A failure is recorded on the item and never retried automatically (a retry could double-post).
 */
export async function publishDue(executors, now = new Date()) {
  const out = [];
  for (const item of list('approved')) {
    if (item.scheduled_at && new Date(item.scheduled_at) > now) continue;
    const run = executors[item.type];
    if (!run) { update(item.id, { status: 'failed', error: `no executor for ${item.type}` }); continue; }
    update(item.id, { status: 'publishing' }); // claim it first so two runs can never both post it
    try {
      const result = await run(item);
      update(item.id, { status: 'done', result: String(result || ''), done_at: new Date().toISOString() });
      log(`queue: published ${item.id} (${item.title})`);
      out.push({ id: item.id, ok: true });
    } catch (e) {
      update(item.id, { status: 'failed', error: String(e.message || e) });
      log(`queue: ${item.id} FAILED: ${e.message}`);
      out.push({ id: item.id, ok: false, error: e.message });
    }
  }
  return out;
}
