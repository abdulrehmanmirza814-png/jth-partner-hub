import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, readJson, writeJson } from '../util.js';

const FILE = () => path.join(DATA, 'state', 'desktop-queue.json');
const load = () => readJson(FILE(), { tasks: [] });

export function addTask(text, source = 'owner') {
  const q = load();
  const t = { id: crypto.randomUUID().slice(0, 8), text: String(text).trim(), source, status: 'queued', created: new Date().toISOString() };
  if (!t.text) throw new Error('empty task');
  q.tasks.push(t);
  q.tasks = q.tasks.slice(-200);
  writeJson(FILE(), q);
  return t;
}
export const listTasks = () => load().tasks;
export const nextQueued = () => load().tasks.find((t) => t.status === 'queued');
export function updateTask(id, patch) {
  const q = load();
  const t = q.tasks.find((x) => x.id === id);
  if (t) { Object.assign(t, patch); writeJson(FILE(), q); }
  return t;
}
/** Anything left "running" from a crashed process is marked failed so it never silently re-runs. */
export function recoverCrashed() {
  const q = load();
  for (const t of q.tasks) if (t.status === 'running') { t.status = 'failed'; t.result = 'interrupted (assistant restarted)'; }
  writeJson(FILE(), q);
}
