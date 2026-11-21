#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ROOT, DATA, CONFIG_DIR, readJson, writeJson, readText, pause, sleep, log } from './util.js';
import { loadConfig } from './config.js';
import { createLLM, decide, textOf } from './llm.js';
import { parseExport, senders, buildPairs, detectOwner } from './whatsapp/parse-export.js';
import { buildIndex, retrieve, styleStats } from './whatsapp/style.js';
import { buildSystemPrompt, buildUserPrompt, DECISION_TOOL, evaluateDecision } from './whatsapp/decision.js';
import { WhatsAppResponder } from './whatsapp/responder.js';
import { selfTest, SEL } from './whatsapp/dom.js';
import { openProfile } from './browser.js';
import { loadTasks } from './web/tasks.js';
import { runTask, loadTaskState } from './web/agent.js';
import { startScheduler } from './scheduler.js';
import { Control } from './desktop/control.js';
import { startDesktopWorker } from './desktop/worker.js';
import { addTask, listTasks } from './desktop/tasks.js';
import { startPanel } from './panel/server.js';
import { authorize, isConnected } from './gmail/auth.js';
import { makeGmail, runBriefing, runMailTriage, buildJobs } from './jobs.js';
import { Meta, socialExecutors } from './social/meta.js';
import { draftPosts } from './social/content.js';
import * as queue from './core/queue.js';
import { research, saveReport } from './tools/research.js';
import { askClaude, askOpenAI, saveAnswer } from './tools/ask.js';
import { delegateTask } from './tools/delegate.js';
import { toScreen } from './desktop/safety.js';
import { scrub } from './privacy.js';

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env is optional */ }

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const positional = args.filter((a) => !a.startsWith('--'));

function needKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and paste your key (console.anthropic.com).');
    process.exit(1);
  }
}

function loadBrain(cfg) {
  const pairs = readJson(path.join(DATA, 'style', 'pairs.json'), []);
  return {
    pairs,
    index: pairs.length ? buildIndex(pairs) : null,
    stats: readJson(path.join(DATA, 'style', 'stats.json'), null),
    styleGuide: readText(path.join(DATA, 'style', 'style-guide.md')),
    kb: readText(path.join(CONFIG_DIR, 'business.md')),
  };
}

async function learn() {
  const cfg = loadConfig();
  const dir = path.join(DATA, 'chats');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')) : [];
  if (!files.length) { console.error(`No .txt chat exports in ${dir}. See README step 3.`); process.exit(1); }
  const chats = files.map((f) => ({ file: f, msgs: parseExport(fs.readFileSync(path.join(dir, f), 'utf8')) })).filter((c) => c.msgs.length);
  const owner = detectOwner(chats, cfg.owner_name);
  console.log(`Owner name: "${owner}"  (set owner_name in config/agent.config.json if this is wrong)`);
  let pairs = [], skipped = 0;
  for (const c of chats) {
    if (senders(c.msgs).length > 2) { skipped++; continue; } // group chats are not 1:1 customer conversations
    pairs.push(...buildPairs(c.msgs, owner, c.file.replace(/\.txt$/, '')));
  }
  const stats = styleStats(pairs);
  writeJson(path.join(DATA, 'style', 'pairs.json'), pairs);
  writeJson(path.join(DATA, 'style', 'stats.json'), stats);
  console.log(`Read ${chats.length} chats (${skipped} group chats skipped) -> ${pairs.length} guest->reply examples.`);
  if (stats) console.log(JSON.stringify(stats, null, 2));
  if (flag('summarize') && pairs.length) {
    needKey();
    const llm = createLLM(cfg.llm);
    const step = Math.max(1, Math.floor(pairs.length / 120));
    const sample = pairs.filter((_, i) => i % step === 0).slice(0, 120)
      .map((p) => `Guest: ${scrub(p.customer).slice(0, 300)}\nAbdul: ${scrub(p.reply).slice(0, 400)}`).join('\n\n');
    const res = await llm.complete({
      max_tokens: 2500,
      system: 'You analyse how a business owner chats with customers on WhatsApp and write a style guide that another writer can follow to sound exactly like him.',
      messages: [{ role: 'user', content: `Below are real exchanges (personal data already masked). Write a practical style guide (max 350 words, bullet points): tone and warmth, how he greets, sentence length, language mix and spelling habits, emoji use, how he asks for booking details, how he gives prices/options, how he closes, phrases he reuses verbatim, and what he never does. Do not include any customer details.\n\n${sample}` }],
    });
    fs.mkdirSync(path.join(DATA, 'style'), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'style', 'style-guide.md'), textOf(res));
    console.log('Wrote data/style/style-guide.md - read it and edit anything that is off.');
  }
}

async function chatTest() {
  needKey();
  const cfg = loadConfig();
  const msg = positional.join(' ');
  if (!msg) { console.error('Usage: npm run chat-test -- "Hi, price for desert safari for 4 adults?"'); process.exit(1); }
  const brain = loadBrain(cfg);
  const llm = createLLM(cfg.llm);
  const examples = brain.index ? retrieve(brain.index, msg, cfg.whatsapp.examples) : [];
  const user = buildUserPrompt({ chatTitle: 'Test guest', history: [], newMessages: [{ text: msg }], examples, isNewChat: true,
    nowText: new Intl.DateTimeFormat('en-GB', { timeZone: cfg.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date()) });
  const result = await decide(llm, { system: buildSystemPrompt({ cfg, kb: brain.kb, styleGuide: brain.styleGuide, stats: brain.stats }), user, tool: DECISION_TOOL });
  const verdict = evaluateDecision(result, { cfg, kb: brain.kb, guestText: msg, mode: 'auto' });
  console.log('\n--- similar past exchanges used:', examples.length);
  console.log('--- model decision:', JSON.stringify(result.input || result, null, 2));
  console.log('--- final verdict (what auto mode would do):', verdict.action.toUpperCase(), '-', verdict.reason || '');
}

async function whatsappPage(cfg, { waitMs = 180000 } = {}) {
  const ctx = process.env.CDP_URL
    ? (await (await import('playwright-core')).chromium.connectOverCDP(process.env.CDP_URL)).contexts()[0]
    : await openProfile('whatsapp');
  const page = ctx.pages().find((p) => p.url().includes('web.whatsapp.com')) || ctx.pages()[0] || (await ctx.newPage());
  if (!page.url().includes('web.whatsapp.com')) await page.goto(cfg.whatsapp.url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector(SEL.pane, { timeout: waitMs });
  } catch {
    console.error('WhatsApp Web did not finish loading. If a QR code is showing, scan it with your phone (WhatsApp > Linked devices) and run again.');
  }
  return { ctx, page };
}

async function login() {
  const cfg = loadConfig();
  const target = positional[0] || 'whatsapp';
  const url = target === 'whatsapp' ? cfg.whatsapp.url : target.startsWith('http') ? target : `https://${target}`;
  const ctx = await openProfile(target === 'whatsapp' ? 'whatsapp' : 'tasks', { headless: false });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(url);
  console.log(`Log in manually in the window that opened (${url}). Close the window when finished; your login is saved on this computer.`);
  await new Promise((r) => ctx.on('close', r));
}

async function selftestCmd() {
  const cfg = loadConfig();
  const { ctx, page } = await whatsappPage(cfg, { waitMs: 60000 });
  console.table(await selfTest(page));
  console.log('Open a chat and run this again to check message/composer selectors.');
  await ctx.close().catch(() => {});
}

async function terminalApprove(text, url) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nAbout to publish on ${url}:\n  "${text}"`);
  const a = (await rl.question('Post it? [y]es / [n]o / [e]dit: ')).trim().toLowerCase();
  let out = { ok: false };
  if (a.startsWith('y')) out = { ok: true };
  else if (a.startsWith('e')) { const t = (await rl.question('New text: ')).trim(); out = t ? { ok: true, text: t } : { ok: false }; }
  rl.close();
  return out;
}

async function taskCmd() {
  const cfg = loadConfig();
  const name = positional[0];
  const tasks = loadTasks();
  if (!name) { console.log('Tasks:\n' + tasks.map((t) => `  ${t.name}  (${t.schedule})`).join('\n')); return; }
  const task = tasks.find((t) => t.name === name);
  if (!task) { console.error(`No task named "${name}". Files go in tasks/*.md`); process.exit(1); }
  needKey();
  if (flag('auto')) task.approval = 'auto';
  const ctx = await openProfile('tasks', { headless: false });
  const llm = createLLM(cfg.llm);
  const r = await runTask(task, { llm, context: ctx, approve: terminalApprove, dry: flag('dry'), gap: cfg.tasks.default_gap_seconds });
  console.log(`\n=== ${r.task}: ${r.status} - ${r.summary}\nPublished: ${r.publishes}`);
  await ctx.close();
}

async function makeDriver(cfg) {
  const { createNutDriver } = await import('./desktop/driver-nut.js');
  return createNutDriver({ maxEdge: cfg.desktop.max_edge, maxMegapixels: cfg.desktop.max_megapixels });
}

async function bringUpDesktop(cfg, llm) {
  const control = new Control();
  const panel = await startPanel({ control, port: cfg.panel.port });
  log(`Control panel (open this in your browser, keep it private): ${panel.url}`);
  let driver = null;
  const stop = startDesktopWorker({ control, llm, getDriver: async () => (driver ||= await makeDriver(cfg)), cfg });
  return { control, panel, stop };
}

async function start() {
  needKey();
  const cfg = loadConfig();
  const brain = loadBrain(cfg);
  const llm = createLLM(cfg.llm);
  log(`JTH assistant starting. WhatsApp mode: ${cfg.mode.toUpperCase()}. Desktop mode: ${cfg.desktop.mode.toUpperCase()}. Examples: ${brain.pairs.length}. Knowledge base: ${brain.kb.length} chars.`);
  if (!brain.kb.trim()) log('WARNING: config/business.md is empty - the assistant will escalate anything needing facts.');
  if (cfg.mode === 'auto') log('WhatsApp AUTO mode: safe replies are sent without review. Risky ones are escalated to you.');

  let desktop = null;
  if (cfg.desktop.enabled) desktop = await bringUpDesktop(cfg, llm);

  let taskCtx = null;
  const stopScheduler = startScheduler({
    getJobs: () => buildJobs({
      cfg, llm, kb: brain.kb,
      runBrowserTask: async (task) => {
        taskCtx ||= await openProfile('tasks', { headless: false });
        return runTask(task, { llm, context: taskCtx, approve: async () => ({ ok: false }), gap: cfg.tasks.default_gap_seconds });
      },
    }),
  });

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; log('Stopping...'); stopScheduler(); desktop?.stop(); });

  if (cfg.whatsapp.enabled === false) { log('WhatsApp is switched off in the config.'); while (!stopping) await sleep(1000); return; }
  const { ctx, page } = await whatsappPage(cfg);
  const responder = new WhatsAppResponder({ cfg, llm, page, ...brain });
  let errors = 0;
  while (!stopping) {
    try {
      const out = await responder.pass();
      if (out.length) log('pass:', out.map((o) => `${o.chat}=${o.outcome}`).join(', '));
      errors = 0;
    } catch (e) {
      errors++;
      log('pass failed:', e.message);
      if (errors >= 3) { await page.reload().catch(() => {}); errors = 0; }
    }
    await pause(cfg.whatsapp.poll_seconds);
  }
  await ctx.close().catch(() => {});
  await taskCtx?.close().catch(() => {});
}

/** Only the desktop assistant + panel (no WhatsApp, no email): the easiest way to try it first. */
async function desktopCmd() {
  needKey();
  const cfg = loadConfig();
  const llm = createLLM(cfg.llm);
  const d = await bringUpDesktop(cfg, llm);
  log(`Desktop assistant is running in ${cfg.desktop.mode.toUpperCase()} mode. Leave this window open. Ctrl+C to quit.`);
  await new Promise((r) => process.on('SIGINT', () => { d.stop(); r(); }));
  process.exit(0);
}

async function doCmd() {
  const text = positional.join(' ');
  if (!text) { console.error('Usage: npm run do -- "Open Gmail and list the emails that need a reply"'); process.exit(1); }
  const t = addTask(text, 'cli');
  console.log(`Queued task ${t.id}. The running assistant (npm start or npm run desktop) will pick it up; watch it in the control panel.`);
}

async function desktopSelfTest() {
  const cfg = loadConfig();
  const d = await makeDriver(cfg);
  const screen = await d.size();
  const shot = await d.screenshot();
  const file = path.join(DATA, 'desktop', 'selftest.jpg');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, shot.jpeg);
  console.log(`Screen (mouse coordinates): ${screen.width}x${screen.height}\nScreenshot sent to the AI: ${shot.width}x${shot.height}  (saved to ${file})\nActive window: "${await d.activeWindowTitle() || '(unknown - window titles unavailable; every Enter after typing will ask you)'}"`);
  const start = await d.mousePosition();
  let worst = 0;
  for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
    const want = toScreen([Math.round(shot.width * fx), Math.round(shot.height * fy)], shot, screen);
    await d.move(want);
    await sleep(150);
    const got = await d.mousePosition();
    worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y));
  }
  await d.move(start);
  console.log(worst <= 4 ? `Mouse mapping OK (worst error ${worst.toFixed(1)}px).` : `WARNING: the mouse landed up to ${worst.toFixed(0)}px away from where it should. This is usually a display-scaling problem (Retina / Windows "Scale 125%+"). Tell me your OS and scaling and I will adjust the driver.`);
}

async function gmailAuthCmd() {
  await authorize();
  console.log('Gmail connected. Try: npm run mail');
}

function needGmail() {
  if (!isConnected()) { console.error('Gmail is not connected. Run: npm run gmail-auth (see README, "Gmail").'); process.exit(1); }
}

async function mailCmd() {
  needKey(); needGmail();
  const cfg = loadConfig(); const brain = loadBrain(cfg);
  const r = await runMailTriage({ gmail: makeGmail(), llm: createLLM(cfg.llm), cfg, kb: brain.kb });
  console.log(r.summary + '. Drafts are in Gmail > Drafts. Run "npm run briefing" for the summary.');
}

async function briefingCmd() {
  needKey(); needGmail();
  const cfg = loadConfig(); const brain = loadBrain(cfg);
  const r = await runBriefing({ gmail: makeGmail(), llm: createLLM(cfg.llm), cfg, kb: brain.kb });
  console.log(r.markdown + `\n(saved to ${r.file})`);
}

async function socialCmd() {
  needKey();
  const sub = positional[0];
  const cfg = loadConfig(); const brain = loadBrain(cfg);
  const voice = readText(path.join(CONFIG_DIR, 'social.md'));
  const llm = createLLM(cfg.llm);
  if (sub === 'draft') {
    const topic = positional.slice(1).join(' ');
    if (!topic) { console.error('Usage: npm run social -- draft "weekend desert safari offer"'); process.exit(1); }
    const platforms = (args.find((a) => a.startsWith('--platforms='))?.split('=')[1] || cfg.social.platforms.join(',')).split(',');
    const items = await draftPosts({ llm, kb: brain.kb, voice, topic, platforms, count: Number(args.find((a) => a.startsWith('--count='))?.split('=')[1] || 1) });
    console.log(`${items.length} post(s) drafted. Nothing is published yet - run: npm run review`);
  } else if (sub === 'plan') {
    const days = Number(args.find((a) => a.startsWith('--days='))?.split('=')[1] || 7);
    const items = await draftPosts({ llm, kb: brain.kb, voice, topic: `A varied ${days}-day content plan using the content pillars; each post a different pillar and angle`, platforms: cfg.social.platforms, count: days });
    console.log(`${items.length} post(s) drafted for review. Run: npm run review`);
  } else { console.error('Usage: npm run social -- draft "<topic>" [--platforms=facebook,instagram] [--count=2]   |   npm run social -- plan [--days=7]'); process.exit(1); }
}

async function reviewCmd() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const meta = new Meta();
  const items = queue.list('pending');
  if (!items.length) console.log('Nothing waiting for approval.');
  for (const it of items) {
    console.log(`\n=== [${it.id}] ${it.payload.platform?.toUpperCase() || it.type}\n${it.preview}\n${it.payload.image_idea ? `\nSuggested photo/video: ${it.payload.image_idea}` : ''}`);
    for (;;) {
      const a = (await rl.question('[a]pprove  [e]dit text  [i]mage URL  [s]chedule  [r]eject  [k]eep for later  [q]uit > ')).trim().toLowerCase();
      if (a === 'q') { rl.close(); return; }
      if (a === 'k') break;
      if (a === 'r') { queue.update(it.id, { status: 'rejected' }); break; }
      if (a === 'e') { const t = (await rl.question('New text (use \\n for a new line): ')).trim().replace(/\\n/g, '\n'); if (t) { it.payload.caption = t; it.preview = t; queue.update(it.id, { payload: it.payload, preview: t }); } continue; }
      if (a === 'i') { const u = (await rl.question('Public image URL (https://...): ')).trim(); if (/^https:\/\//.test(u)) { it.payload.image_url = u; queue.update(it.id, { payload: it.payload }); } else console.log('Needs a public https:// link.'); continue; }
      if (a === 's') { const when = (await rl.question('When? e.g. 2026-11-22 18:30 (your computer time) > ')).trim(); const d = new Date(when.replace(' ', 'T')); if (isNaN(d)) { console.log('Could not read that date.'); continue; } it.scheduled_at = d.toISOString(); queue.update(it.id, { scheduled_at: it.scheduled_at }); console.log(`Will publish at ${d.toString()} once approved.`); continue; }
      if (a === 'a') {
        if (!meta.ready(it.payload.platform)) { console.log(`Cannot publish: ${it.payload.platform} is not connected (see README, "Facebook & Instagram").`); continue; }
        if (it.payload.platform === 'instagram' && !it.payload.image_url) { console.log('Instagram needs an image: press i and paste a public image link.'); continue; }
        queue.update(it.id, { status: 'approved' });
        const out = await queue.publishDue(socialExecutors(meta));
        console.log(out.find((o) => o.id === it.id)?.ok ? 'Published.' : out.find((o) => o.id === it.id)?.error ? `Failed: ${out.find((o) => o.id === it.id).error}` : `Approved. It will publish at ${it.scheduled_at || 'the next 5-minute check while npm start is running'}.`);
        break;
      }
    }
  }
  rl.close();
}

function queueCmd() {
  const [sub, id] = positional;
  if (sub === 'retry' && id) { queue.update(id, { status: 'approved', error: undefined }); console.log('Re-approved. Check first that the post did not already go out.'); return; }
  for (const i of queue.list()) console.log(`${i.id}  ${i.status.padEnd(10)} ${i.title}${i.error ? `  (${i.error})` : ''}`);
}

async function researchCmd() {
  needKey();
  const cfg = loadConfig();
  const question = positional.join(' ');
  if (!question) { console.error('Usage: npm run research -- "What are competitors charging for a Dubai desert safari?" [--sites=tripadvisor.com,getyourguide.com]'); process.exit(1); }
  const sites = (args.find((a) => a.startsWith('--sites='))?.split('=')[1] || '').split(',').filter(Boolean);
  const r = await research({ llm: createLLM(cfg.llm), question, sites: sites.length ? sites : cfg.research.sites, toolsNote: readText(path.join(CONFIG_DIR, 'research.md')) });
  const file = saveReport(question, r.report);
  console.log(r.report + `\n(saved to ${file})`);
}

async function askCmd() {
  const [who, ...rest] = positional;
  const prompt = rest.join(' ');
  if (!['claude', 'openai'].includes(who) || !prompt) { console.error('Usage: npm run ask -- claude "Write a 30-second video script for our dhow cruise"   |   npm run ask -- openai "..."'); process.exit(1); }
  const cfg = loadConfig();
  let answer;
  if (who === 'claude') { needKey(); answer = await askClaude({ llm: createLLM(cfg.llm), prompt, kb: loadBrain(cfg).kb }); } else answer = await askOpenAI({ prompt });
  console.log(answer + `\n(saved to ${saveAnswer(who, prompt, answer)})`);
}

async function delegateCmd() {
  needKey();
  const [target, ...rest] = positional;
  const prompt = rest.join(' ');
  if (!prompt) { console.error('Usage: npm run delegate -- chatgpt "..."   |   npm run delegate -- claude "..."   (uses the website with the login saved by: npm run login -- https://chatgpt.com)'); process.exit(1); }
  const cfg = loadConfig();
  const ctx = await openProfile('tasks', { headless: false });
  const r = await runTask(delegateTask({ target, prompt }), { llm: createLLM(cfg.llm), context: ctx, approve: async () => ({ ok: false }), gap: [0, 0] });
  console.log(`${r.status}: ${r.summary}`);
  await ctx.close();
}

function status() {
  const cfg = loadConfig();
  const wa = readJson(path.join(DATA, 'state', 'whatsapp.json'), null);
  console.log(`Mode: ${cfg.mode}   Model: ${cfg.llm.model}`);
  console.log(wa ? `WhatsApp replies sent today: ${wa.day?.count ?? 0}, last hour: ${(wa.sentAt || []).filter((t) => Date.now() - t < 3600e3).length}` : 'WhatsApp: no activity yet');
  for (const t of loadTasks()) {
    const s = loadTaskState(t.name);
    console.log(`Task ${t.name} (${t.schedule}): last run ${s.lastRun || 'never'}, published today ${s.publishes[new Date().toISOString().slice(0, 10)] || 0}`);
  }
  const alerts = path.join(DATA, 'owner-alerts.md');
  console.log(fs.existsSync(alerts) ? `Owner alerts file: ${alerts}` : 'No alerts.');
}

const commands = {
  learn, 'chat-test': chatTest, login, selftest: selftestCmd, start, task: taskCmd, status,
  desktop: desktopCmd, do: doCmd, 'desktop-selftest': desktopSelfTest,
  'gmail-auth': gmailAuthCmd, mail: mailCmd, briefing: briefingCmd,
  social: socialCmd, review: reviewCmd, queue: queueCmd, research: researchCmd, ask: askCmd, delegate: delegateCmd,
};
if (!commands[cmd]) {
  console.log('Commands: start | desktop | do "<task>" | desktop-selftest | learn | chat-test | login | selftest | task | status | gmail-auth | mail | briefing | social | review | queue | research | ask | delegate');
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
