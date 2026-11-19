import path from 'node:path';
import { chromium } from 'playwright-core';
import { DATA } from './util.js';

/**
 * Each "profile" is its own saved Chrome window (cookies, logins). The WhatsApp window and the
 * task window are separate, so a long Facebook task never blocks WhatsApp replies.
 */
export async function openProfile(name, { headless = process.env.HEADLESS === '1' } = {}) {
  const opts = { headless, viewport: { width: 1366, height: 850 }, args: ['--no-first-run'] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  else opts.channel = 'chrome';
  try {
    return await chromium.launchPersistentContext(path.join(DATA, 'profiles', name), opts);
  } catch (e) {
    if (/Executable doesn't exist|chrome.*not found|distribution/i.test(e.message)) {
      throw new Error('Google Chrome was not found. Install Chrome from google.com/chrome, or set CHROME_PATH in .env to your Chrome/Chromium executable.');
    }
    throw e;
  }
}
