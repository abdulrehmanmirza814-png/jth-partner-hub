// Pure safety rules for the desktop agent. No I/O, so every rule is unit-tested.

export function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

/** True for card numbers, private keys and long token-like strings: never typed without approval. */
export function looksSecret(text) {
  const s = String(text);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) return 'private key';
  for (const m of s.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return 'card number';
  }
  if (/^\S{24,}$/.test(s) && /[a-z]/i.test(s) && /\d/.test(s) && !/^https?:\/\//i.test(s) && !/[\\/]/.test(s)) return 'token or password';
  return '';
}

export const maskSecret = (s) => (s.length <= 4 ? '***' : `${s.slice(0, 2)}${'*'.repeat(Math.min(12, s.length - 2))}`);

export function titleMatches(title, patterns) {
  const t = String(title || '').toLowerCase();
  return patterns.find((p) => t.includes(String(p).toLowerCase())) || '';
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Mouse parked in a screen corner = the owner's emergency stop. */
export function inCorner(p, screen, margin = 3) {
  return (p.x <= margin || p.x >= screen.width - 1 - margin) && (p.y <= margin || p.y >= screen.height - 1 - margin);
}

/** Validates a [x, y] from the model against the screenshot it saw and maps it to real screen pixels. */
export function toScreen(coord, img, screen) {
  if (!Array.isArray(coord) || coord.length !== 2 || !coord.every(Number.isFinite)) throw new Error('coordinate must be [x, y]');
  const [x, y] = coord;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) throw new Error(`coordinate [${x}, ${y}] is outside the ${img.width}x${img.height} screenshot`);
  return { x: Math.round((x * screen.width) / img.width), y: Math.round((y * screen.height) / img.height) };
}
