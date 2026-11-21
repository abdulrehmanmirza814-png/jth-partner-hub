import path from 'node:path';
import { DATA, CONFIG_DIR, readJson, writeJson, readText } from './util.js';
import { alertOwner } from './notify.js';
import { Gmail } from './gmail/client.js';
import { tokenProvider, isConnected } from './gmail/auth.js';
import { triageInbox, buildBriefing, briefingPath } from './gmail/triage.js';
import { Meta, socialExecutors } from './social/meta.js';
import { draftPosts } from './social/content.js';
import * as queue from './core/queue.js';
import { loadTasks } from './web/tasks.js';
import { addTask } from './desktop/tasks.js';
import fs from 'node:fs';

const ACC = () => path.join(DATA, 'state', 'briefing-entries.json');

export const makeGmail = () => new Gmail({ getToken: tokenProvider() });

export async function runMailTriage({ gmail, llm, cfg, kb }) {
  const entries = await triageInbox({ gmail, llm, cfg, kb });
  const acc = readJson(ACC(), { entries: [] });
  acc.entries.push(...entries);
  writeJson(ACC(), acc);
  for (const e of entries.filter((x) => x.importance === 'urgent' || x.action === 'flag')) {
    await alertOwner({ title: `${e.importance === 'urgent' ? 'Urgent email' : 'Email needs you'}: ${e.subject.slice(0, 60)}`, body: `${e.from}\n${e.summary || ''}${e.warn ? `\n${e.warn}` : ''}` });
  }
  return { status: 'ok', summary: `${entries.length} new email(s)` };
}

export async function runBriefing({ gmail, llm, cfg, kb }) {
  const fresh = await triageInbox({ gmail, llm, cfg, kb });
  const acc = readJson(ACC(), { entries: [] });
  const entries = [...acc.entries, ...fresh];
  const md = buildBriefing({ entries, pendingPosts: queue.list('pending').length, timezone: cfg.timezone });
  const file = briefingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md);
  writeJson(ACC(), { entries: [] });
  const urgent = entries.filter((e) => e.importance === 'urgent').length;
  await alertOwner({ title: 'Your morning briefing is ready', body: `${entries.length} emails, ${urgent} urgent.\n${file}` });
  return { status: 'ok', summary: file, file, markdown: md };
}

export async function runSocialPlan({ llm, cfg, kb }) {
  const voice = readText(path.join(CONFIG_DIR, 'social.md'));
  const items = await draftPosts({ llm, kb, voice, topic: cfg.social.plan.topic, platforms: cfg.social.platforms, count: cfg.social.plan.count || 1 });
  if (items.length) await alertOwner({ title: `${items.length} social post(s) drafted`, body: 'Run: npm run review' });
  return { status: 'ok', summary: `${items.length} drafted` };
}

/** The list of everything that runs by itself, built from what is connected and configured. */
export function buildJobs({ cfg, llm, kb, runBrowserTask }) {
  const jobs = [];
  if (isConnected()) {
    const gmail = makeGmail();
    jobs.push({ name: 'mail-triage', schedule: `every ${cfg.email.check_every_minutes}m`, run: () => runMailTriage({ gmail, llm, cfg, kb }) });
    jobs.push({ name: 'morning-briefing', schedule: `daily ${cfg.briefing.at}`, run: () => runBriefing({ gmail, llm, cfg, kb }) });
  }
  const meta = new Meta();
  jobs.push({ name: 'social-publish', schedule: 'every 5m', run: async () => ({ status: 'ok', summary: `${(await queue.publishDue(socialExecutors(meta))).length} published` }) });
  if (cfg.social.plan?.at) jobs.push({ name: 'social-plan', schedule: `daily ${cfg.social.plan.at}`, run: () => runSocialPlan({ llm, cfg, kb }) });
  for (const t of loadTasks()) {
    jobs.push({
      name: `task:${t.name}`, schedule: t.schedule,
      run: async () => (t.mode === 'desktop'
        ? { status: 'queued', summary: `queued ${addTask(t.instructions, `schedule:${t.name}`).id} for the desktop assistant` }
        : runBrowserTask(t)),
    });
  }
  return jobs;
}
