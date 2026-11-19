// All WhatsApp Web page knowledge lives here. WhatsApp changes its markup now and then;
// `npm run selftest` reports which of these selectors still match so a fix is a one-file edit.
import { rand } from '../util.js';

export const SEL = {
  pane: '#pane-side',
  main: '#main',
  composer: 'footer [contenteditable="true"]',
};

/** Unread chats in the sidebar. */
export function listChats(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('#pane-side');
    if (!pane) return null;
    let rows = [...pane.querySelectorAll('[role="listitem"], [role="row"]')];
    rows = rows.filter((r) => !rows.some((o) => o !== r && r.contains(o)));
    return rows.map((row, i) => {
      row.setAttribute('data-jth-row', String(i));
      const title = row.querySelector('span[title]')?.getAttribute('title') || '';
      const badge = row.querySelector('[aria-label*="unread" i]');
      let unread = 0;
      if (badge) unread = parseInt((badge.getAttribute('aria-label').match(/\d+/) || ['1'])[0], 10) || 1;
      return { index: i, title, unread };
    });
  });
}

/** Re-reads the sidebar right before clicking, so a re-render between passes can't send us to the wrong row. */
export async function openChat(page, title) {
  const rows = (await listChats(page)) || [];
  const row = rows.find((r) => r.title === title && r.unread > 0) || rows.find((r) => r.title === title);
  if (!row) throw new Error(`chat "${title}" is no longer in the sidebar`);
  await page.locator(`[data-jth-row="${row.index}"]`).first().click({ timeout: 8000 });
  await page.waitForSelector(SEL.main, { timeout: 10000 });
}

/** Snapshot of the open chat: header info, composer text and recent messages. */
export function readChat(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#main');
    if (!main) return null;
    const header = main.querySelector('header');
    const titles = [...(header?.querySelectorAll('span[title]') || [])].map((e) => e.getAttribute('title'));
    const subtitle = titles.slice(1).join(' ');
    const isGroup = !!main.querySelector('[data-icon="default-group"]') || subtitle.includes(',');
    const composer = main.querySelector('footer [contenteditable="true"]');
    const seen = new Set();
    const messages = [];
    for (const el of main.querySelectorAll('[data-id]')) {
      const id = el.getAttribute('data-id');
      if (!/^(true|false)_/.test(id) || seen.has(id)) continue;
      seen.add(id);
      const textEl = el.querySelector('.copyable-text span.selectable-text, [data-testid="selectable-text"], span.selectable-text');
      const text = (textEl?.innerText || '').trim();
      const media = !text && !!el.querySelector('img, audio, video, [data-icon*="audio"], [data-icon*="ptt"], [data-icon*="document"], [data-icon*="video"]');
      messages.push({ id, out: id.startsWith('true_'), text, media });
    }
    return { title: titles[0] || '', isGroup, composerText: (composer?.innerText || '').trim(), messages: messages.slice(-60) };
  });
}

export async function typeInComposer(page, text, msPerChar) {
  const box = page.locator(SEL.composer).first();
  await box.click();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i], { delay: msPerChar ? rand(msPerChar[0], msPerChar[1]) : 0 });
    if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');
  }
}

export async function pressSend(page) {
  await page.keyboard.press('Enter');
}

export async function closeChat(page) {
  await page.keyboard.press('Escape');
}

/** Used by `npm run selftest`. */
export async function selfTest(page) {
  const checks = await page.evaluate((SEL) => ({
    'sidebar (#pane-side)': !!document.querySelector(SEL.pane),
    'chat rows': document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]').length,
    'chat titles (span[title])': document.querySelectorAll('#pane-side span[title]').length,
    'unread badges': document.querySelectorAll('#pane-side [aria-label*="unread" i]').length,
    'open chat (#main)': !!document.querySelector(SEL.main),
    'message rows ([data-id])': document.querySelectorAll('#main [data-id]').length,
    'message text spans': document.querySelectorAll('#main span.selectable-text').length,
    'composer': !!document.querySelector(SEL.composer),
  }), SEL);
  return checks;
}
