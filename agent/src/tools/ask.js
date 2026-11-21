import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../util.js';
import { textOf } from '../llm.js';

export async function askClaude({ llm, prompt, kb = '' }) {
  const res = await llm.complete({
    max_tokens: 8000,
    system: `You are the personal assistant of Abdul Rehman, owner of JTH Tourism (UAE inbound tourism). Do the task he gives you carefully and completely. For scripts, captions or plans, write them ready to use. Do not invent facts about the business; use only this knowledge, and say what is missing:\n\n${kb}`,
    messages: [{ role: 'user', content: prompt }],
  });
  return textOf(res);
}

/** Official OpenAI API (not the ChatGPT website). Needs OPENAI_API_KEY and OPENAI_MODEL in .env. */
export async function askOpenAI({ prompt, fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL }) {
  if (!apiKey) throw new Error('Set OPENAI_API_KEY in .env (platform.openai.com > API keys).');
  if (!model) throw new Error('Set OPENAI_MODEL in .env to the OpenAI model name you want to use.');
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI: ${data.error?.message || res.status}`);
  return data.choices?.[0]?.message?.content || '';
}

export function saveAnswer(who, prompt, answer) {
  const dir = path.join(DATA, 'answers');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${who}.md`);
  fs.writeFileSync(file, `# Prompt\n${prompt}\n\n# Answer (${who})\n${answer}\n`);
  return file;
}
