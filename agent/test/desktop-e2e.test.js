// Whole loop on a real (virtual) screen: real screenshot -> scripted "AI" -> real mouse/keyboard -> real page.
// Skipped without a display. Run: xvfb-run -a -s "-screen 0 1280x800x24" node --test test/desktop-e2e.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { tempEnv } from './helpers.js';

tempEnv();
const hasDisplay = !!process.env.DISPLAY && process.env.JTH_REAL_DRIVER !== '0';
const { DEFAULTS } = await import('../src/config.js');
const { runDesktopTask } = await import('../src/desktop/agent.js');
const { Control } = await import('../src/desktop/control.js');

let browser, page, driver, origin;
before(async () => {
  if (!hasDisplay) return;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: false, args: ['--no-sandbox', '--window-position=0,0', '--window-size=1100,750'] });
  page = await (await browser.newContext({ viewport: null })).newPage();
  await page.setContent(`<title>idle</title><body style="margin:0"><input id="msg" style="position:absolute;left:200px;top:200px;width:400px;height:40px;font-size:20px">
    <script>document.getElementById('msg').addEventListener('keydown',e=>{if(e.key==='Enter')document.title='submitted:'+e.target.value})</script>`);
  await page.bringToFront();
  const { createNutDriver } = await import('../src/desktop/driver-nut.js');
  driver = await createNutDriver();
  origin = await page.evaluate(() => ({ x: window.screenX, y: window.screenY + (window.outerHeight - window.innerHeight) }));
});
after(async () => { await browser?.close(); });

/** Scripted model: reads the screenshot size from the prompt and aims at the input box in SCREENSHOT pixels. */
function scriptedModel(steps) {
  let n = 0;
  return { async complete(p) {
    const [, w, h] = /Screenshot is (\d+)x(\d+)/.exec(p.messages[0].content[0].text).map(Number);
    const screen = await driver.size();
    const box = await page.evaluate(() => { const r = document.getElementById('msg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const shot = [Math.round(((origin.x + box.x) * w) / screen.width), Math.round(((origin.y + box.y) * h) / screen.height)];
    return { stop_reason: 'tool_use', content: steps[n++](shot) };
  } };
}
const cu = (name, input) => ({ type: 'tool_use', id: `t${Math.random()}`, name, toolset_name: 'computer', input });
const custom = (name, input) => ({ type: 'tool_use', id: `t${Math.random()}`, name, input });

test('E2E: the assistant clicks a real input, types, and the Enter key waits for owner approval before sending', { skip: !hasDisplay }, async () => {
  const control = new Control();
  let asked = null;
  const poll = setInterval(() => { if (control.pending) { asked = control.pending; control.resolveApproval(control.pending.id, true); } }, 20);
  const llm = scriptedModel([
    (at) => [custom('note', { text: 'clicking the message box' }), cu('left_click', { coordinate: at }), cu('type', { text: 'Hello JTH guest' }), cu('key', { text: 'Return' })],
    () => [custom('done', { summary: 'message submitted' })],
  ]);
  const r = await runDesktopTask({ text: 'Send hello', llm, driver, control, cfg: { ...DEFAULTS, desktop: { ...DEFAULTS.desktop, settle_ms: 100 } } });
  clearInterval(poll);
  assert.equal(r.status, 'done');
  assert.equal(asked?.kind, 'send'); // window title is unknown here, so the safe default (ask) applied
  assert.match(asked.text, /Hello JTH guest/);
  assert.equal(await page.title(), 'submitted:Hello JTH guest');
});

test('E2E: a declined send leaves the page untouched', { skip: !hasDisplay }, async () => {
  await page.evaluate(() => { document.title = 'idle'; document.getElementById('msg').value = ''; });
  const control = new Control();
  const poll = setInterval(() => { if (control.pending) control.resolveApproval(control.pending.id, false); }, 20);
  const llm = scriptedModel([
    (at) => [cu('left_click', { coordinate: at }), cu('type', { text: 'Do not send this' }), cu('key', { text: 'Return' })],
    () => [custom('done', { summary: 'stopped before sending' })],
  ]);
  await runDesktopTask({ text: 'Send hello', llm, driver, control, cfg: { ...DEFAULTS, desktop: { ...DEFAULTS.desktop, settle_ms: 100 } } });
  clearInterval(poll);
  assert.equal(await page.title(), 'idle');
  assert.equal(await page.inputValue('#msg'), 'Do not send this'); // typed, but never submitted
});
