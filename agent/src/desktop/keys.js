// Turns Claude's key strings ("ctrl+s", "Return", "alt+Tab") into nut-js Key values.
const MOD = { ctrl: 'LeftControl', control: 'LeftControl', alt: 'LeftAlt', option: 'LeftAlt', shift: 'LeftShift' };
const NAMED = {
  return: 'Return', enter: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', page_up: 'PageUp', prior: 'PageUp', pagedown: 'PageDown', page_down: 'PageDown', next: 'PageDown',
  insert: 'Insert', minus: 'Minus', '-': 'Minus', equal: 'Equal', '=': 'Equal', plus: 'Add',
};

/** @returns {Array} nut-js Key values: modifiers first, main key last */
export function parseCombo(text, Key, platform = process.platform) {
  const parts = String(text || '').split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('empty key');
  const sup = platform === 'darwin' ? 'LeftCmd' : 'LeftSuper';
  return parts.map((p) => {
    const k = p.toLowerCase();
    let name = MOD[k] || (['super', 'win', 'windows', 'meta', 'cmd', 'command'].includes(k) ? sup : NAMED[k]);
    if (!name && /^f([1-9]|1[0-2])$/.test(k)) name = k.toUpperCase();
    if (!name && /^[a-z]$/.test(k)) name = k.toUpperCase();
    if (!name && /^[0-9]$/.test(k)) name = `Num${k}`;
    const v = name && Key[name];
    if (v === undefined) throw new Error(`unsupported key "${p}"`);
    return v;
  });
}

export const isEnterCombo = (text) => /(^|\+)(return|enter)$/i.test(String(text).trim());
