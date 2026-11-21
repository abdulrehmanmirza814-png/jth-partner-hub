import path from 'node:path';
import { DATA, readJson, writeJson, log } from './util.js';
import { isDue } from './web/tasks.js';

/**
 * Checks every minute whether a job is due and runs one at a time.
 * A job is { name, schedule, run }. schedule: "every 30m" | "every 6h" | "daily 08:00" | "manual".
 */
export function startScheduler({ getJobs, intervalMs = 60000 }) {
  let busy = false;
  const file = path.join(DATA, 'state', 'schedule.json');
  const tick = async () => {
    if (busy) return;
    const last = readJson(file, {});
    const job = getJobs().find((j) => isDue(j.schedule, last[j.name]));
    if (!job) return;
    busy = true;
    log(`scheduler: running "${job.name}"`);
    try {
      const r = await job.run();
      log(`scheduler: "${job.name}" finished${r?.status ? ` -> ${r.status}` : ''}${r?.summary ? ` (${String(r.summary).slice(0, 100)})` : ''}`);
    } catch (e) {
      log(`scheduler: "${job.name}" crashed: ${e.message}`);
    }
    last[job.name] = new Date().toISOString(); // recorded even on failure, so a broken job can't loop every minute
    writeJson(file, last);
    busy = false;
  };
  const timer = setInterval(() => tick().catch((e) => log('scheduler error', e.message)), intervalMs);
  tick().catch(() => {});
  return () => clearInterval(timer);
}
