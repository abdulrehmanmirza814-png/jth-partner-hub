import Anthropic from '@anthropic-ai/sdk';

/**
 * Thin wrapper around the Anthropic SDK. Anything exposing `complete(params)` works,
 * which is how the tests plug in a scripted fake.
 */
export function createLLM(cfg) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  const useFallbacks = cfg.fallbacks !== false && /opus-5|fable|sonnet-5-5/.test(cfg.model);

  async function complete({ system, messages, tools, max_tokens }) {
    const params = {
      model: cfg.model,
      max_tokens: max_tokens ?? cfg.max_tokens,
      system,
      messages,
    };
    if (cfg.effort) params.output_config = { effort: cfg.effort };
    if (tools) {
      params.tools = tools;
      // Forced tool_choice is rejected by the newest models, so use auto and instruct in the prompt.
      params.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
    }
    if (useFallbacks) {
      return client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    }
    return client.messages.create(params);
  }
  return { complete, model: cfg.model };
}

export function textOf(response) {
  return (response?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * Ask the model to answer by calling a single tool, return that tool's input.
 * Returns { input } on success, { refused: true } if the model declined, or { error } otherwise.
 */
export async function decide(llm, { system, user, tool, attempts = 2 }) {
  const messages = [{ role: 'user', content: user }];
  let lastText = '';
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await llm.complete({ system, messages, tools: [tool] });
    } catch (e) {
      return { error: String(e?.message || e) };
    }
    if (res.stop_reason === 'refusal') return { refused: true };
    const call = (res.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (call) return { input: call.input };
    lastText = textOf(res);
    messages.push({ role: 'assistant', content: [{ type: 'text', text: lastText || '(no answer)' }] });
    messages.push({ role: 'user', content: `Reply only by calling the ${tool.name} tool.` });
  }
  return { error: `model did not call ${tool.name}: ${lastText.slice(0, 200)}` };
}
