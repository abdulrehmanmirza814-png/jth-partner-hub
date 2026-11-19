import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExport, buildPairs, detectOwner, senders } from '../src/whatsapp/parse-export.js';
import { buildIndex, retrieve, styleStats } from '../src/whatsapp/style.js';
import { scrub } from '../src/privacy.js';

const ANDROID = `12/03/2025, 14:05 - Messages and calls are end-to-end encrypted.
12/03/2025, 14:06 - John Smith: Hi, how much is the desert safari for 4 adults?
12/03/2025, 14:07 - John Smith: Pickup from Marina
12/03/2025, 14:10 - JTH Abdul: Hello John 😊
Desert safari is AED 150 per person with pickup.
12/03/2025, 14:11 - John Smith: <Media omitted>
12/03/2025, 14:12 - John Smith: Ok book it for tomorrow
12/03/2025, 14:15 - JTH Abdul: Done sir, confirmed. See you tomorrow!`;

const IOS = `[12/03/2025, 2:06:10 PM] Sara: Do you have a yacht cruise?
[12/03/2025, 2:09:00 PM] JTH Abdul: Yes, dhow and yacht both available. Which date?`;

test('parses android export incl. multi-line and media, ignores system lines', () => {
  const m = parseExport(ANDROID);
  assert.equal(m.length, 6);
  assert.equal(m[2].text, 'Hello John 😊\nDesert safari is AED 150 per person with pickup.');
  assert.equal(m[3].media, true);
  assert.deepEqual(senders(m), ['John Smith', 'JTH Abdul']);
});

test('parses iPhone export with 12h time', () => {
  const m = parseExport(IOS);
  assert.equal(m.length, 2);
  assert.equal(m[0].sender, 'Sara');
  assert.ok(m[1].ts > m[0].ts);
});

test('builds guest->owner pairs and detects owner across chats', () => {
  const a = parseExport(ANDROID), b = parseExport(IOS);
  const owner = detectOwner([{ msgs: a }, { msgs: b }]);
  assert.equal(owner, 'JTH Abdul');
  const pairs = buildPairs(a, owner, 'john');
  assert.equal(pairs.length, 2);
  assert.match(pairs[0].customer, /desert safari/);
  assert.match(pairs[0].reply, /AED 150/);
});

test('retrieves the most similar past situation first', () => {
  const pairs = [
    ...buildPairs(parseExport(ANDROID), 'JTH Abdul'),
    ...buildPairs(parseExport(IOS), 'JTH Abdul'),
  ];
  const idx = buildIndex(pairs);
  const hit = retrieve(idx, 'is there a yacht cruise available?', 2);
  assert.match(hit[0].reply, /dhow and yacht/);
  assert.equal(retrieve(idx, 'zzzz qqqq', 2).length, 0);
});

test('style stats and scrubbing', () => {
  const pairs = buildPairs(parseExport(ANDROID), 'JTH Abdul');
  const s = styleStats(pairs);
  assert.equal(s.sample, 2);
  assert.ok(s.medianWords > 0);
  assert.equal(scrub('call +971 50 123 4567 or a@b.com'), 'call [phone] or [email]');
});
