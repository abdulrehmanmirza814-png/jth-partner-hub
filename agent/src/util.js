import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.JTH_DATA_DIR || path.join(ROOT, 'data');
export const CONFIG_DIR = process.env.JTH_CONFIG_DIR || path.join(ROOT, 'config');
export const TASKS_DIR = process.env.JTH_TASKS_DIR || path.join(ROOT, 'tasks');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (a, b) => a + Math.random() * (b - a);
/** Sleep a random number of seconds within [min,max]. Skipped when JTH_FAST=1 (tests). */
export const pause = (range) => (process.env.JTH_FAST ? Promise.resolve() : sleep(rand(range[0], range[1]) * 1000));

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2));
  fs.renameSync(file + '.tmp', file);
}
export function appendText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
}
export function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

export const today = () => new Date().toISOString().slice(0, 10);

export function log(...args) {
  const line = `${new Date().toISOString().slice(11, 19)} ${args.join(' ')}`;
  console.log(line);
  try { appendText(path.join(DATA, 'logs', `agent-${today()}.log`), line + '\n'); } catch { /* ignore */ }
}

export function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = k in base && typeof v === 'object' && v !== null && !Array.isArray(v) ? deepMerge(base[k], v) : v;
  }
  return out;
}
