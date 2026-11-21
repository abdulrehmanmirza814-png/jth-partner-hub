const TARGETS = {
  chatgpt: { start_url: 'https://chatgpt.com/', allowed_domains: ['chatgpt.com', 'openai.com'], label: 'ChatGPT' },
  claude: { start_url: 'https://claude.ai/new', allowed_domains: ['claude.ai', 'anthropic.com'], label: 'Claude' },
};

/**
 * Builds a one-off browser task that types a prompt into ChatGPT or Claude (the websites, using
 * your saved login) and saves the finished answer to data/delegated/. Nothing is published.
 */
export function delegateTask({ target, prompt }) {
  const t = TARGETS[target];
  if (!t) throw new Error(`target must be one of: ${Object.keys(TARGETS).join(', ')}`);
  return {
    name: `delegate-${target}`, file: '', schedule: 'manual', start_url: t.start_url, allowed_domains: t.allowed_domains,
    max_steps: 40, max_minutes: 20, max_publishes_per_run: 0, max_publishes_per_day: 0, approval: 'ask', vision: true,
    instructions: `Use ${t.label} on its website to do a job for Abdul.
1. If a login page or captcha appears, call ask_owner (never log in yourself).
2. Click the message box, then use "type" to enter EXACTLY the prompt between the markers below (no changes), then use "press" with Enter.
3. Wait for the answer to finish. Use "wait" a few seconds at a time (up to about 3 minutes) until the answer has stopped appearing and there is no "Stop" button / generating indicator.
4. Call "save_page" with key_name "answer" to save the whole page text, then call "done" with a one-line summary.
Do not click anything that shares, publishes or changes settings.

<<<PROMPT
${prompt}
PROMPT>>>`,
  };
}
