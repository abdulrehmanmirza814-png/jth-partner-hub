// The real driver: moves the real mouse, presses real keys, takes real screenshots.
// Uses nut.js (input), screenshot-desktop + sharp (screen), active-win (window title).
import { parseCombo } from './keys.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ASCII = /^[\x20-\x7e]*$/;

export async function createNutDriver({ maxEdge = 1568, maxMegapixels = 1.15, platform = process.platform } = {}) {
  const nut = await import('@nut-tree-fork/nut-js');
  const { mouse, keyboard, screen, clipboard, Key, Button, Point, straightTo } = nut;
  const sharp = (await import('sharp')).default;
  const shot = (await import('screenshot-desktop')).default;
  let activeWin = null;
  try { activeWin = (await import('active-win')).default; } catch { /* window titles unavailable */ }
  mouse.config.mouseSpeed = 1800;
  mouse.config.autoDelayMs = 20;
  keyboard.config.autoDelayMs = 35;

  // One key at a time: batching several keys into one call can drop the final key-release on X11.
  const down = async (keys) => { for (const k of keys) await keyboard.pressKey(k); };
  const up = async (keys) => { for (const k of keys.slice().reverse()) await keyboard.releaseKey(k); };
  const press = async (keys) => { await down(keys); await sleep(30); await up(keys); await sleep(30); };
  const withMods = async (mods, fn) => {
    const keys = mods ? parseCombo(mods, Key, platform) : [];
    await down(keys);
    try { await fn(); } finally { await up(keys); }
  };
  const moveTo = async (x, y) => { await mouse.move(straightTo(new Point(x, y))); await sleep(60); };

  return {
    name: 'nut',
    async size() { return { width: await screen.width(), height: await screen.height() }; },

    /** JPEG scaled to fit the model's image limits. Direct screen grab first, screenshot-desktop as fallback. */
    async screenshot() {
      let img;
      try {
        const g = await (await screen.grab()).toRGB();
        img = sharp(g.data, { raw: { width: g.width, height: g.height, channels: g.channels || 4 } });
      } catch {
        let buf;
        try { const d = await shot.listDisplays(); buf = await shot({ screen: d[0]?.id, format: 'png' }); } catch { buf = await shot({ format: 'png' }); }
        img = sharp(buf);
      }
      const meta = await img.metadata();
      const scale = Math.min(1, maxEdge / Math.max(meta.width, meta.height), Math.sqrt((maxMegapixels * 1e6) / (meta.width * meta.height)));
      const width = Math.round(meta.width * scale), height = Math.round(meta.height * scale);
      const jpeg = await img.removeAlpha().resize({ width, height }).jpeg({ quality: 72 }).toBuffer();
      return { jpeg, width, height };
    },

    async mousePosition() { const p = await mouse.getPosition(); return { x: p.x, y: p.y }; },
    async activeWindowTitle() {
      try { const w = await activeWin?.(); return w ? `${w.owner?.name || ''} - ${w.title || ''}` : ''; } catch { return ''; }
    },

    async click({ x, y, button = 'left', count = 1, modifiers }) {
      await moveTo(x, y);
      const b = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE }[button];
      await withMods(modifiers, async () => {
        if (count === 2) await mouse.doubleClick(b);
        else if (count === 3) { await mouse.doubleClick(b); await mouse.click(b); }
        else await mouse.click(b);
      });
    },
    async drag({ from, to, modifiers }) {
      await moveTo(from.x, from.y);
      await withMods(modifiers, async () => {
        await mouse.pressButton(Button.LEFT);
        await moveTo(to.x, to.y);
        await mouse.releaseButton(Button.LEFT);
      });
    },
    async move({ x, y }) { await moveTo(x, y); },
    async scroll({ x, y, direction, amount, modifiers }) {
      if (Number.isFinite(x)) await moveTo(x, y);
      const n = Math.max(1, Math.min(50, Math.round(amount || 3))) * 3;
      await withMods(modifiers, async () => {
        await { up: mouse.scrollUp, down: mouse.scrollDown, left: mouse.scrollLeft, right: mouse.scrollRight }[direction].call(mouse, n);
      });
    },
    async typeText(text) {
      if (ASCII.test(text) && text.length <= 60 && !text.includes('\n')) { await keyboard.type(text); return; }
      // Long text, accents, Arabic, emoji and newlines: paste through the clipboard (fast and exact).
      let old = ''; try { old = await clipboard.getContent(); } catch { /* ignore */ }
      await clipboard.setContent(text);
      await press(parseCombo(platform === 'darwin' ? 'cmd+v' : 'ctrl+v', Key, platform));
      await sleep(250);
      try { await clipboard.setContent(old); } catch { /* ignore */ }
    },
    async key(combo, repeat = 1) {
      const keys = parseCombo(combo, Key, platform);
      for (let i = 0; i < Math.max(1, Math.min(100, repeat)); i++) await press(keys);
    },
  };
}
