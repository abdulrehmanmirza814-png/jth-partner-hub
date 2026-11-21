import { log, sleep } from '../util.js';
import { alertOwner } from '../notify.js';
import { runDesktopTask } from './agent.js';
import { nextQueued, updateTask, recoverCrashed } from './tasks.js';

/** Picks queued desktop tasks one at a time and runs them. Returns a function that stops the worker. */
export function startDesktopWorker({ control, llm, getDriver, cfg, pollMs = 2000 }) {
  let alive = true;
  recoverCrashed();
  (async () => {
    while (alive) {
      const t = control.enabled && control.status === 'idle' ? nextQueued() : null;
      if (!t) { await sleep(pollMs); continue; }
      updateTask(t.id, { status: 'running', started: new Date().toISOString() });
      let r;
      try {
        r = await runDesktopTask({ text: t.text, llm, driver: await getDriver(), control, cfg, taskId: t.id });
      } catch (e) {
        r = { status: 'error', summary: e.message };
        control.status = 'idle'; control.current = null;
        log(`desktop task crashed: ${e.stack || e.message}`);
      }
      updateTask(t.id, { status: r.status === 'done' ? 'done' : r.status === 'stopped' ? 'stopped' : 'failed', result: `${r.status}: ${r.summary}`, finished: new Date().toISOString(), runId: r.runId });
      await alertOwner({ title: `Task ${r.status}: ${t.text.slice(0, 50)}`, body: String(r.summary).slice(0, 400) });
    }
  })();
  return () => { alive = false; };
}
