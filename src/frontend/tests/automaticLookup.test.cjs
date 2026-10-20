require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { automaticLookup } = require('../src/components/agents/chatbot/automaticLookup.ts');
const { ChatInput } = require('../src/components/agents/chatbot/ChatInput.tsx');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('current public questions use exactly the current question for lookup', () => {
  for (const query of ['What is the weather in Jay, Florida today?',
    'What are the latest CDC vaccination guidelines?', 'Who is the current US president?',
    'What changed in Azure pricing this week?', 'Look up the population of Florida',
    'Search the web for Azure login error 50089']) {
    assert.deepEqual(automaticLookup(query), {webQuery: query});
  }
});

test('ordinary reasoning, transformations, opt-outs and contextual follow-ups stay in chat', () => {
  for (const query of ['Explain how DNS resolution works.', 'Calculate 12 * 4.',
    'Rewrite the latest news as a poem', 'What is the latest on that?',
    'What is its price today?', 'What are current options for our app?',
    'Without using the internet, explain current transformers.', 'Do not search the web for today’s news.',
    'Do not look up the latest news.', 'Don\'t browse for current prices.',
    'Search latest news\nPasted source text', 'latest ' + 'x'.repeat(1000)]) {
    assert.equal(automaticLookup(query), undefined, query);
  }
});

test('identifier and sensitive-context cues suppress automatic lookup without claiming PHI detection', () => {
  for (const query of ['Latest treatment for patient Jane Example',
    'Check current status of example@example.com', 'Look up 555-123-4567',
    'Latest MRN 12345678', 'Current password reset token abc',
    'Latest internal system outage', 'Look up the current billing balance',
    'Latest synthetic patient scenario']) {
    assert.equal(automaticLookup(query), undefined, query);
  }
});

test('a standalone public HTTPS URL selects page reading; token-bearing and private URLs do not', () => {
  assert.deepEqual(automaticLookup('https://www.cdc.gov/'), {webUrls:['https://www.cdc.gov/']});
  for (const query of ['https://example.com/?code=abc', 'https://example.com/#secret',
    'https://user:pass@example.com/', 'https://127.0.0.1/', 'https://169.254.169.254/',
    'https://[::1]/', 'https://intranet.local/', 'https://localhost/',
    'https://example.com:8443/', 'Read the latest on https://example.com/']) {
    assert.equal(automaticLookup(query), undefined, query);
  }
});

async function composer(capabilities, run) {
  const sent = [];
  const calls = [];
  global.fetch = async url => { calls.push(url); return new Response(JSON.stringify(capabilities)); };
  let root;
  await act(async () => { root = create(React.createElement(ChatInput, {isGenerating:false, onSubmit:(...args)=>sent.push(args)})); });
  const click = label => act(async () => root.root.findAllByType('button').find(button=>button.props.children===label).props.onClick());
  const send = async text => {
    await act(async () => root.root.findByType('textarea').props.onChange({target:{value:text}}));
    await act(async () => root.root.findAllByType('button').find(button=>button.props['aria-label']==='Send message').props.onClick());
  };
  try { await run({root, sent, calls, click, send}); }
  finally { await act(async () => root.unmount()); }
}

const beta = {capabilities:['chat'], dataMode:'non_sensitive_beta', webEnabled:true};

test('Auto is the beta default and repeats fresh lookups without selecting Web', async () => {
  await composer(beta, async ({root, sent, calls, send}) => {
    assert.equal(root.root.findAllByType('button').find(button=>button.props.children==='Auto').props['aria-pressed'], true);
    await send('What is the weather in Jay, Florida today?');
    await send('What is the latest news from NASA?');
    assert.equal(sent[0][1].webQuery, sent[0][0]);
    assert.equal(sent[1][1].webQuery, sent[1][0]);
    assert.deepEqual(calls, ['/api/capabilities']); // Nothing is fetched while typing.
  });
});

test('Chat is an explicit session-only opt-out and Web returns to Auto', async () => {
  await composer(beta, async ({sent, click, send}) => {
    await click('Chat');
    await send('What is the weather in Jay, Florida today?');
    assert.equal(sent[0][1].webQuery, undefined);
    await click('Web');
    await send('public query');
    assert.equal(sent[1][1].webQuery, 'public query');
    await send('Latest news from NASA');
    assert.equal(sent[2][1].webQuery, 'Latest news from NASA');
  });
});

test('Auto never searches a message with a pending file', async () => {
  await composer(beta, async ({root, sent, send}) => {
    const file = new File(['Only a synthetic file'], 'example.txt');
    await act(async () => root.root.findByType('input').props.onChange({target:{files:[file],value:''}}));
    await send('What is the latest news?');
    assert.equal(sent[0][1].webQuery, undefined);
    assert.equal(sent[0][1].webUrls, undefined);
    assert.equal(sent[0][1].files[0], file);
  });
});

test('Auto cannot activate outside an explicitly enabled non-sensitive beta', async () => {
  for (const capabilities of [
    {capabilities:['chat'],dataMode:'phi',webEnabled:false},
    {capabilities:['chat'],dataMode:'phi',webEnabled:true},
    {capabilities:['chat'],dataMode:'non_sensitive_beta',webEnabled:false},
  ]) await composer(capabilities, async ({root, sent, send}) => {
    assert.equal(root.root.findAllByType('button').some(button=>button.props.children==='Auto'), false);
    await send('What is the latest news?');
    assert.equal(sent[0][1].webQuery, undefined);
  });
});
