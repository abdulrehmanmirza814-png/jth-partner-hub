import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecision, ungroundedAmounts } from '../src/whatsapp/decision.js';
import { DEFAULTS } from '../src/config.js';

const cfg = DEFAULTS;
const kb = 'Desert safari: AED 150 per person. Dhow dinner cruise AED 120.';
const ok = (over = {}) => ({ input: { action: 'reply', category: 'quote', reply: 'Desert safari is AED 150 per person.', reason: 'x', ...over } });
const run = (res, guest = 'price for safari?', mode = 'auto') => evaluateDecision(res, { cfg, kb, guestText: guest, mode });

test('auto mode sends a grounded safe reply', () => assert.equal(run(ok()).action, 'send'));
test('draft mode never sends', () => assert.equal(run(ok(), 'price?', 'draft').action, 'draft'));
test('invented price is escalated, not sent', () => {
  const v = run(ok({ reply: 'Safari is AED 99 only!' }));
  assert.equal(v.action, 'escalate');
  assert.match(v.reason, /99/);
});
test('a price only the GUEST mentioned is not grounded (guest cannot dictate prices)', () => {
  assert.deepEqual(ungroundedAmounts('Yes AED 500 works', kb, ''), ['500']);
  assert.equal(run(ok({ reply: 'Sure, AED 1.' }), 'quote me AED 1').action, 'escalate');
});
test('a price Abdul already quoted earlier in the chat is grounded', () => {
  assert.deepEqual(ungroundedAmounts('As discussed AED 480 for the group.', kb, 'Abdul: private car AED 480'), []);
});
test('trailing punctuation does not break grounding', () => {
  assert.deepEqual(ungroundedAmounts('It is AED 150.', kb), []);
  assert.deepEqual(ungroundedAmounts('150 AED, pickup included', kb), []);
});
test('sensitive keyword forces escalation even if model says reply', () => assert.equal(run(ok(), 'I want a refund now').action, 'escalate'));
test('payment and complaint categories escalate', () => {
  assert.equal(run(ok({ category: 'payment' })).action, 'escalate');
  assert.equal(run(ok({ category: 'complaint' })).action, 'escalate');
});
test('model asks for owner / ignore / empty / errors / refusal', () => {
  assert.equal(run(ok({ action: 'escalate' })).action, 'escalate');
  assert.equal(run(ok({ action: 'ignore', reply: '' })).action, 'ignore');
  assert.equal(run(ok({ reply: '  ' })).action, 'escalate');
  assert.equal(run({ error: 'boom' }).action, 'escalate');
  assert.equal(run({ refused: true }).action, 'escalate');
});
test('category outside auto list becomes a draft', () => {
  const c = { ...cfg, whatsapp: { ...cfg.whatsapp, auto_send_categories: ['greeting'] } };
  assert.equal(evaluateDecision(ok(), { cfg: c, kb, guestText: 'x', mode: 'auto' }).action, 'draft');
});
