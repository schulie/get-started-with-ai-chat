require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { useChatSession } = require('../src/components/agents/hooks/useChatSession.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;

function setup() {
  const timers = new Map();
  let serial = 0;
  const events = new EventTarget();
  global.window = { setTimeout(fn, ms) { timers.set(++serial, { fn, ms }); return serial; },
    clearTimeout(id) { timers.delete(id); }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let session, root;
  function Harness() { session = useChatSession(); return null; }
  return { async mount() { await act(async () => { root = create(React.createElement(Harness)); }); },
    get session() { return session; }, timers, async close() { await act(async () => root.unmount()); } };
}
const reply = (text = 'Synthetic reply') => new Response(`data: ${JSON.stringify({ type: 'completed_message', content: text })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });

test('follow-up sends prior answers as assistant and retains completed duration', async () => {
  const app = setup(); const calls = [];
  global.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return reply(); };
  await app.mount();
  try {
    await act(async () => app.session.onSend('First synthetic question'));
    assert.equal(app.session.isResponding, false);
    assert.equal(app.session.messageList[1].role, 'assistant');
    assert.equal(app.session.task.phase, 'completed');
    assert.equal(typeof app.session.task.durationMs, 'number');
    await act(async () => app.session.onSend('Follow-up'));
    assert.deepEqual(calls[1].messages.map(item => item.role), ['user', 'assistant', 'user']);
  } finally { await app.close(); }
});
test('HTTP failures stop the task and retry does not duplicate the question', async () => {
  const app = setup(); let calls = 0;
  global.fetch = async () => ++calls === 1 ? new Response('private-canary', { status: 429 }) : reply();
  await app.mount();
  try {
    await act(async () => app.session.onSend('Synthetic question'));
    assert.equal(app.session.isResponding, false);
    assert.equal(app.session.task.phase, 'failed');
    assert.equal(app.session.error.includes('canary'), false);
    await act(async () => app.session.retry());
    assert.equal(app.session.messageList.filter(item => !item.isAnswer).length, 1);
    assert.equal(app.session.task.phase, 'completed');
  } finally { await app.close(); }
});
test('authentication failures and origin rejections have distinct safe messages', async () => {
  for (const [status, body, expected] of [
    [401, 'private-canary', /sign-in has expired/],
    [403, { error: { code: 'origin_rejected', message: 'private-canary' } }, /Reload the page/],
    [403, { error: { message: 'private-canary' } }, /Access to this request was denied/],
  ]) {
    const app = setup();
    global.fetch = async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
    await app.mount();
    try {
      await act(async () => app.session.onSend('Synthetic question'));
      assert.match(app.session.error, expected);
      if (status === 403) assert.doesNotMatch(app.session.error, /expired|Sign in again/);
      assert.doesNotMatch(app.session.error, /canary/);
      assert.equal(app.session.isResponding, false);
    } finally { await app.close(); }
  }
});
test('clearing a session rejects a late response from the old request', async () => {
  const app = setup(); let resolveOld; let calls = 0;
  global.fetch = () => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(reply('New reply'));
  await app.mount();
  try {
    await act(async () => app.session.onSend('Old question'));
    await act(async () => app.session.clearSession());
    await act(async () => app.session.onSend('New question'));
    await act(async () => { resolveOld(reply('Old private canary')); });
    assert.deepEqual(app.session.messageList.map(item => item.content), ['New question', 'New reply']);
    assert.equal(app.session.task.phase, 'completed');
  } finally { await app.close(); }
});
test('Stop cancels reading and freezes a stopped duration', async () => {
  const app = setup();
  global.fetch = async () => new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } });
  await app.mount();
  try {
    await act(async () => app.session.onSend('Synthetic question'));
    assert.equal(app.session.isResponding, true);
    await act(async () => app.session.stop());
    assert.equal(app.session.isResponding, false);
    assert.equal(app.session.task.phase, 'stopped');
    assert.equal(typeof app.session.task.durationMs, 'number');
  } finally { await app.close(); }
});
test('editing branches history and inactivity removes all chat content', async () => {
  const app = setup(); const calls = [];
  global.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return reply(); };
  await app.mount();
  try {
    await act(async () => app.session.onSend('Original question'));
    const originalId = app.session.messageList[0].id;
    await act(async () => app.session.onSend('Revised question', originalId));
    assert.deepEqual(calls[1].messages, [{ role: 'user', content: 'Revised question' }]);
    const idle = [...app.timers.values()].find(timer => timer.ms === 900_000);
    await act(async () => idle.fn());
    assert.equal(app.session.messageList.length, 0);
    assert.equal(app.session.task, undefined);
    assert.equal(app.session.canRetry, false);
  } finally { await app.close(); }
});

test('uploads are prepared once, follow-ups reuse parts, and clear drops attachments', async () => {
  const app = setup(); const calls = [];
  global.fetch = async (url, options) => {
    calls.push({url, body: JSON.parse(options.body)});
    return url === '/api/attachments' ? new Response(JSON.stringify({parts: [{type: 'text', text: 'Synthetic document'}]})) : reply();
  };
  await app.mount();
  try {
    const file = new File(['Synthetic document'], 'synthetic.txt');
    await act(async () => app.session.onSend('Review', undefined, {files: [file], mode: 'chat'}));
    assert.deepEqual(calls.map(call => call.url), ['/api/attachments', '/chat']);
    assert.equal(calls[1].body.messages[0].attachments[0].text, 'Synthetic document');
    assert.equal(app.session.messageList[0].uploads, undefined);
    await act(async () => app.session.onSend('Follow up'));
    assert.deepEqual(calls.map(call => call.url), ['/api/attachments', '/chat', '/chat']);
    await act(async () => app.session.clearSession());
    assert.equal(app.session.messageList.length, 0);
    assert.equal(app.session.canRetry, false);
  } finally { await app.close(); }
});

test('clearing while parsing prevents a late upload from starting chat', async () => {
  const app = setup(); let resolve; const calls = [];
  global.fetch = (url) => { calls.push(url); return new Promise(done => { resolve = done; }); };
  await app.mount();
  try {
    await act(async () => app.session.onSend('Review', undefined, {files: [new File(['Synthetic'], 'test.txt')]}));
    await act(async () => app.session.clearSession());
    await act(async () => resolve(new Response(JSON.stringify({parts: [{type: 'text', text: 'Late private content'}]}))));
    assert.deepEqual(calls, ['/api/attachments']);
    assert.equal(app.session.messageList.length, 0);
  } finally { await app.close(); }
});

test('web reads send only selected URLs and follow-ups reuse the source without another fetch', async () => {
  const app = setup(); const calls = [];
  global.fetch = async (url, options) => {
    calls.push({url, body: JSON.parse(options.body)});
    return url === '/api/web' ? new Response(JSON.stringify({parts: [{type: 'text', text: 'Public source https://example.com/'}]})) : reply();
  };
  await app.mount();
  try {
    await act(async () => app.session.onSend('Summarize', undefined, {webUrls: ['https://example.com/']}));
    assert.deepEqual(calls[0], {url: '/api/web', body: {urls: ['https://example.com/']}});
    assert.equal(app.session.messageList[0].webUrls, undefined);
    assert.match(calls[1].body.messages[0].attachments[0].text, /example.com/);
    await act(async () => app.session.onSend('Follow up'));
    assert.deepEqual(calls.map(call => call.url), ['/api/web', '/chat', '/chat']);
  } finally { await app.close(); }
});

test('search uses only its explicit public query even when a document is attached', async () => {
  const app = setup(); const calls = [];
  global.fetch = async (url, options) => {
    calls.push({url, body: JSON.parse(options.body)});
    return url === '/api/search' ? new Response(JSON.stringify({parts: [{type:'text', text:'Public search source https://example.com/'}]}))
      : url === '/api/attachments' ? new Response(JSON.stringify({parts: [{type:'text', text:'Synthetic document'}]})) : reply();
  };
  await app.mount();
  try {
    await act(async () => app.session.onSend('Use these sources', undefined, {webQuery:'public query', files:[new File(['Synthetic'], 'sample.txt')]}));
    assert.deepEqual(calls[0], {url:'/api/search', body:{query:'public query'}});
    assert.equal(calls[2].body.messages[0].attachments.length, 2);
    await act(async () => app.session.onSend('Follow up'));
    assert.equal(calls.filter(call => call.url === '/api/search').length, 1);
  } finally { await app.close(); }
});
