import path from 'node:path';
import { DATA, appendText, log } from './util.js';

/** Tell the owner something needs attention. Always writes a file; optionally pushes to ntfy.sh. */
export async function alertOwner({ title, body }) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  appendText(path.join(DATA, 'owner-alerts.md'), `\n### ${stamp} - ${title}\n${body}\n`);
  log(`ALERT: ${title} - ${body.split('\n')[0]}`);
  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', headers: { Title: title.slice(0, 80) }, body: body.slice(0, 500) });
    } catch (e) { log('ntfy failed:', e.message); }
  }
}
