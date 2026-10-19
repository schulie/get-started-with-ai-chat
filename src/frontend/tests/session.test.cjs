require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readChatStream, formatDuration } = require('../src/components/agents/chatbot/session.ts');
const { mediaTarget } = require('../src/components/core/media.ts');
const { parseChartSpec } = require('../src/components/core/chartSpec.ts');
const encoder = new TextEncoder();
const event = (type, content) => `data: ${JSON.stringify({ type, content })}\n\n`;
function wire(text, oneByte = false) {
  const bytes = encoder.encode(text);
  return new ReadableStream({ start(controller) {
    if (oneByte) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  }});
}

test('UTF-8, CRLF and split frames preserve streamed text', async () => {
  const updates = [];
  await readChatStream(wire((event('message', 'Héllo ') + event('message', 'clinic') + event('stream_end')).replaceAll('\n', '\r\n'), true), new AbortController().signal, text => updates.push(text));
  assert.equal(updates.at(-1), 'Héllo clinic');
});
test('final snapshot replaces deltas rather than duplicating them', async () => {
  let text;
  await readChatStream(wire(event('message', 'Part') + event('completed_message', 'Part and finish')), new AbortController().signal, value => { text = value; });
  assert.equal(text, 'Part and finish');
});
test('unterminated final SSE frame is accepted', async () => {
  let text;
  await readChatStream(wire(event('completed_message', 'OK').trimEnd()), new AbortController().signal, value => { text = value; });
  assert.equal(text, 'OK');
});
test('truncated and malformed streams fail instead of leaving a running clock', async () => {
  for (const text of [event('message', 'Unfinished'), 'data: invalid\n\n', event('completed_message', ''), 'data: [DONE]\n\n']) {
    await assert.rejects(readChatStream(wire(text), new AbortController().signal, () => {}));
  }
});
test('provider failures do not expose response bodies', async () => {
  const text = `data: ${JSON.stringify({ error: { message: 'synthetic-private-canary' } })}\n\n`;
  await assert.rejects(readChatStream(wire(text), new AbortController().signal, () => {}), error => !error.message.includes('canary'));
});
test('Stop releases a pending stream', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const pending = readChatStream(new ReadableStream({ cancel() { cancelled = true; } }), controller.signal, () => {});
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});
test('duration has stable minute and second formatting', () => {
  assert.equal(formatDuration(65_999), '01:05');
  assert.equal(formatDuration(0), '00:00');
});
test('media extensions work while external or unsafe embeds are blocked', () => {
  const origin = 'https://clinic.example';
  assert.equal(mediaTarget('/media/movie.mp4?token=x', origin).kind, 'video');
  assert.equal(mediaTarget('/media/sound.MP3', origin).kind, 'audio');
  assert.equal(mediaTarget('/media/report.pdf', origin).kind, 'pdf');
  assert.equal(mediaTarget('/media/report.pdf', origin).canEmbed, true);
  assert.equal(mediaTarget('/.auth/logout', origin).canEmbed, false);
  assert.equal(mediaTarget('https://outside.example/image.png', origin).canEmbed, false);
  for (const raw of ['javascript:alert(1)', 'data:text/html,hello', 'http://outside.example/a', 'https://user:pass@clinic.example/media/a']) assert.equal(mediaTarget(raw, origin), null);
});
test('charts accept bounded data without accepting executable definitions', () => {
  const valid = { type: 'bar', title: 'Synthetic counts', data: [{ label: 'A', value: 4 }, { label: 'B', value: -2 }] };
  assert.equal(parseChartSpec(JSON.stringify(valid)).data.length, 2);
  for (const bad of [ { ...valid, type: 'javascript' }, { ...valid, data: [{ label: 'A', value: 'eval(1)' }] },
    { ...valid, type: 'pie', data: [{ label: 'A', value: -2 }] }, { ...valid, data: Array(41).fill(valid.data[0]) },
    { ...valid, data: [{ label: 'A', value: 1e20 }] } ]) assert.equal(parseChartSpec(JSON.stringify(bad)), null);
});
