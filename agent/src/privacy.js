/** Mask personal identifiers before text is used as a prompt example or sent to a summariser. */
export function scrub(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[phone]')
    .replace(/\b[A-Z]{1,2}\d{6,9}\b/g, '[id]')
    .replace(/https?:\/\/\S+/g, (u) => (/jettoholidays|jth/i.test(u) ? u : '[link]'));
}
