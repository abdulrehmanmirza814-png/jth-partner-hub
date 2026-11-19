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

async function start() {
  needKey();
  const cfg = loadConfig();
  const brain = loadBrain(cfg);
  const llm = createLLM(cfg.llm);
  log(`JTH agent starting. WhatsApp mode: ${cfg.mode.toUpperCase()}. Examples loaded: ${brain.pairs.length}. Knowledge base: ${brain.kb.length} chars.`);
  if (!brain.kb.trim()) log('WARNING: config/business.md is empty - the assistant will escalate anything needing facts.');
  if (cfg.mode === 'auto') log('AUTO mode: safe replies are sent without review. Risky ones are escalated to you.');

  let stopScheduler = () => {};
  let taskCtx = null;
  if (loadTasks().length) {
    stopScheduler = startScheduler({
      run: async (task) => {
        taskCtx ||= await openProfile('tasks', { headless: false });
        return runTask(task, { llm, context: taskCtx, approve: async () => ({ ok: false }), gap: cfg.tasks.default_gap_seconds });
      },
    });
  }

  const { ctx, page } = await whatsappPage(cfg);
  const responder = new WhatsAppResponder({ cfg, llm, page, ...brain });
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; log('Stopping...'); stopScheduler(); });
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

const commands = { learn, 'chat-test': chatTest, login, selftest: selftestCmd, start, task: taskCmd, status };
if (!commands[cmd]) {
  console.log('Commands: learn [--summarize] | chat-test "<message>" | login [whatsapp|<url>] | selftest | start | task [name] [--dry] [--auto] | status');
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
