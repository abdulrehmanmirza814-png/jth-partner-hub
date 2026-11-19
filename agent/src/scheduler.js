import path from 'node:path';
import { DATA, readJson, writeJson, log } from './util.js';
import { loadTasks, isDue } from './web/tasks.js';

/** Checks every minute whether a task is due; runs one task at a time. */
export function startScheduler({ run, intervalMs = 60000 }) {
  let busy = false;
  const file = path.join(DATA, 'state', 'schedule.json');
  const tick = async () => {
    if (busy) return;
    const last = readJson(file, {});
    for (const t of loadTasks()) {
      if (!isDue(t.schedule, last[t.name])) continue;
      busy = true;
      log(`scheduler: running task "${t.name}"`);
      try {
        const r = await run(t);
        log(`scheduler: "${t.name}" -> ${r.status} (${r.publishes} published) ${r.summary}`);
      } catch (e) {
        log(`scheduler: "${t.name}" crashed: ${e.message}`);
      }
      last[t.name] = new Date().toISOString();
      writeJson(file, last);
      busy = false;
      break; // one task per tick
    }
  };
  const timer = setInterval(() => tick().catch((e) => log('scheduler error', e.message)), intervalMs);
  tick().catch(() => {});
  return () => clearInterval(timer);
}
