// Real-input test: drives an actual (virtual) screen with the real nut.js driver.
// Runs only when a display exists, e.g.:  xvfb-run -a -s "-screen 0 1280x800x24" node --test test/driver-real.test.js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { tempEnv } from './helpers.js';

tempEnv();
const hasDisplay = !!process.env.DISPLAY && process.env.JTH_REAL_DRIVER !== '0';
const HTML = `<!doctype html><title>start</title><body style="margin:0;height:3000px">
<button id="b" style="position:absolute;left:100px;top:100px;width:200px;height:80px" onclick="document.title='clicked'">Click me</button>
<input id="i" style="position:absolute;left:100px;top:220px;width:300px;height:40px">
<div id="a" style="position:absolute;left:500px;top:100px;width:100px;height:100px;background:#c33"></div>
<div id="z" style="position:absolute;left:800px;top:300px;width:100px;height:100px;background:#33c"></div>
<script>window.ev=[];addEventListener('mousedown',e=>ev.push(['down',e.clientX,e.clientY]));addEventListener('mouseup',e=>ev.push(['up',e.clientX,e.clientY]));
document.getElementById('b').addEventListener('dblclick',()=>document.title='dbl');</script></body>`;

let browser, page, driver, origin;
before(async () => {
  if (!hasDisplay) return;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless: false, args: ['--no-sandbox', '--window-position=0,0', '--window-size=1100,750', '--disable-infobars'] });
  page = await (await browser.newContext({ viewport: null })).newPage();
  await page.setContent(HTML);
  await page.bringToFront();
  const { createNutDriver } = await import('../src/desktop/driver-nut.js');
  driver = await createNutDriver();
  origin = await page.evaluate(() => ({ x: window.screenX, y: window.screenY + (window.outerHeight - window.innerHeight) }));
});
after(async () => { await browser?.close(); });

const center = async (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const toScreen = async (sel) => { const c = await center(sel); return { x: Math.round(origin.x + c.x), y: Math.round(origin.y + c.y) }; };

test('screenshot is scaled to the model limits and the screen size is reported', { skip: !hasDisplay }, async () => {
  const size = await driver.size();
  const shot = await driver.screenshot();
  assert.ok(size.width > 0 && size.height > 0);
  assert.ok(Math.max(shot.width, shot.height) <= 1568);
  assert.ok(shot.width * shot.height <= 1.16e6);
  assert.equal(shot.jpeg[0], 0xff); // JPEG magic bytes
  assert.ok(Math.abs(shot.width / shot.height - size.width / size.height) < 0.02);
});

test('a real mouse click lands on the button, a double click fires dblclick', { skip: !hasDisplay }, async () => {
  const p = await toScreen('#b');
  await driver.click(p);
  assert.equal(await page.title(), 'clicked');
  const pos = await driver.mousePosition();
  assert.ok(Math.hypot(pos.x - p.x, pos.y - p.y) <= 2, `mouse at ${pos.x},${pos.y} wanted ${p.x},${p.y}`);
  await new Promise((r) => setTimeout(r, 800)); // let the single-click window expire
  await driver.click({ ...p, count: 2 });
  assert.equal(await page.title(), 'dbl');
});

test('real typing: ASCII by keystrokes, unicode and long text via clipboard paste; ctrl+a / BackSpace work', { skip: !hasDisplay }, async () => {
  const p = await toScreen('#i');
  await driver.click(p);
  await driver.typeText('hello Dubai');
  assert.equal(await page.inputValue('#i'), 'hello Dubai');
  await driver.key('ctrl+a');
  await driver.key('BackSpace');
  assert.equal(await page.inputValue('#i'), '');
  await driver.typeText('مرحبا بكم ☀ Dubai');
  assert.equal(await page.inputValue('#i'), 'مرحبا بكم ☀ Dubai');
  await driver.key('ctrl+a');
  await driver.key('BackSpace');
  await driver.key('a', 3);
  assert.equal(await page.inputValue('#i'), 'aaa');
});

test('real drag presses at the start and releases at the end; real scroll moves the page', { skip: !hasDisplay }, async () => {
  const a = await toScreen('#a'), z = await toScreen('#z');
  await driver.drag({ from: a, to: z });
  const ev = await page.evaluate(() => window.ev);
  const down = ev.filter((e) => e[0] === 'down').at(-1), up = ev.filter((e) => e[0] === 'up').at(-1);
  const ca = await center('#a'), cz = await center('#z');
  assert.ok(Math.hypot(down[1] - ca.x, down[2] - ca.y) <= 3, `down ${down}`);
  assert.ok(Math.hypot(up[1] - cz.x, up[2] - cz.y) <= 3, `up ${up}`);
  await driver.scroll({ ...a, direction: 'down', amount: 5 });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await page.evaluate(() => window.scrollY)) > 0);
  await driver.scroll({ ...a, direction: 'up', amount: 20 });
});
