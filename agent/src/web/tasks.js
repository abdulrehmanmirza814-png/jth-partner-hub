import fs from 'node:fs';
import path from 'node:path';
import { TASKS_DIR } from '../util.js';

/** A task is a plain-English .md file with an optional settings header between --- lines. */
export function parseTask(text, file = '') {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  const meta = {};
  let body = text;
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const kv = /^\s*([\w_]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (kv && !line.trim().startsWith('#')) meta[kv[1]] = kv[2];
    }
  }
  const num = (k, d) => (meta[k] !== undefined && meta[k] !== '' ? Number(meta[k]) : d);
  const bool = (k, d) => (meta[k] === undefined ? d : /^(true|yes|1)$/i.test(meta[k]));
  return {
    name: meta.name || path.basename(file, '.md'),
    file,
    instructions: body.trim(),
    schedule: meta.schedule || 'manual', // manual | every 6h | every 30m | daily 10:00
    start_url: meta.start_url || '',
    allowed_domains: (meta.allowed_domains || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    max_steps: num('max_steps', 60),
    max_minutes: num('max_minutes', 30),
    max_publishes_per_run: num('max_publishes_per_run', 5),
    max_publishes_per_day: num('max_publishes_per_day', 10),
    approval: meta.approval === 'auto' ? 'auto' : 'ask', // ask = you confirm each public post in the terminal
    vision: bool('vision', false),
  };
}

export function loadTasks(dir = TASKS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .map((f) => parseTask(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f)));
}

/** Returns true if the task is due now. `last` is an ISO string or undefined. */
export function isDue(schedule, last, now = new Date()) {
  const s = schedule.trim().toLowerCase();
  const lastMs = last ? Date.parse(last) : 0;
  let m;
  if ((m = /^every\s+(\d+)\s*(m|min|h|hr|hour|hours)s?$/.exec(s))) {
    const ms = Number(m[1]) * (m[2].startsWith('m') ? 60e3 : 3600e3);
    return now - lastMs >= ms;
  }
  if ((m = /^daily\s+(\d{1,2}):(\d{2})$/.exec(s))) {
    const due = new Date(now); due.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return now >= due && lastMs < due.getTime();
  }
  return false;
}
