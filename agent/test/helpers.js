import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jth-agent-'));
  process.env.JTH_DATA_DIR = dir;
  process.env.JTH_FAST = '1';
  return dir;
}

export async function launch() {
  const executablePath = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  return { browser, context: await browser.newContext() };
}

/** Fake LLM: `fn(callParams)` returns a tool input object (or null for "no tool call"). */
export function fakeLLM(fn) {
  const calls = [];
  return {
    calls,
    async complete(params) {
      calls.push(params);
      const input = await fn(params, calls.length);
      if (input === null) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no tool' }] };
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: params.tools[0].name, input }] };
    },
  };
}
