/** Runs inside the page: lists visible interactive elements and tags them with data-jth-id. */
export const OBSERVE = () => {
  document.querySelectorAll('[data-jth-id]').forEach((e) => e.removeAttribute('data-jth-id'));
  const vh = innerHeight, vw = innerWidth;
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=menuitem],[role=tab],[role=checkbox],[role=combobox],[contenteditable=""],[contenteditable="true"]';
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < -vh * 0.1 || r.top > vh * 1.1 || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const tag = el.tagName.toLowerCase();
    const editable = el.isContentEditable || tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'checkbox', 'radio', 'image'].includes(el.type));
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 90);
    if (!label && !editable) continue;
    n++;
    el.setAttribute('data-jth-id', String(n));
    elements.push({ id: n, role: el.getAttribute('role') || (tag === 'a' ? 'link' : tag), editable, label, href: tag === 'a' ? (el.getAttribute('href') || '').slice(0, 80) : undefined });
    if (n >= 100) break;
  }
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 2500);
  return { url: location.href, title: document.title, text, elements, scrollY: Math.round(scrollY), scrollMax: Math.max(0, document.documentElement.scrollHeight - innerHeight) };
};

export function formatObservation(o) {
  const els = o.elements.map((e) => `[${e.id}] ${e.role}${e.editable ? ' (text box)' : ''} "${e.label}"${e.href ? ` -> ${e.href}` : ''}`).join('\n');
  return `URL: ${o.url}\nTitle: ${o.title}\nScroll: ${o.scrollY}px of ${o.scrollMax}px\n\nVisible text (truncated):\n${o.text}\n\nClickable / typeable elements (use the number as "id"):\n${els || '(none visible - try scrolling)'}`;
}
