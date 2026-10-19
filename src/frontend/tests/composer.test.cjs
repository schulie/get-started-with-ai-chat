require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { renderToStaticMarkup } = require('react-dom/server');
const { ChatInput } = require('../src/components/agents/chatbot/ChatInput.tsx');
const { Chart } = require('../src/components/core/Chart.tsx');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('starter drafts submit once and composition Enter never sends', async () => {
  const sent = [];
  let root;
  await act(async () => { root = create(React.createElement(ChatInput, { isGenerating: false, draft: { id: 1, text: 'Synthetic draft' }, onSubmit: value => sent.push(value) })); });
  try {
    let area = root.root.findByType('textarea');
    await act(async () => area.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault() {} }));
    assert.equal(sent.length, 0);
    await act(async () => area.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} }));
    assert.deepEqual(sent, ['Synthetic draft']);
    area = root.root.findByType('textarea');
    assert.equal(area.props.value, '');
  } finally { await act(async () => root.unmount()); }
});
test('attachment content is not transmitted before Send', async () => {
  const sent = [];
  let root;
  await act(async () => { root = create(React.createElement(ChatInput, { isGenerating: false, onSubmit: value => sent.push(value) })); });
  try {
    const input = root.root.findByType('input');
    await act(async () => input.props.onChange({ target: { files: [{ name: 'synthetic.csv', size: 20, text: async () => 'Group,Count\nA,3' }], value: '' } }));
    assert.equal(sent.length, 0);
    assert.match(root.root.findByType('textarea').props.value, /Group,Count/);
    const send = root.root.findAllByType('button').find(button => button.props.children === 'Send');
    await act(async () => send.props.onClick());
    assert.match(sent[0], /synthetic.csv/);
  } finally { await act(async () => root.unmount()); }
});
test('chart labels remain escaped data in SVG output', () => {
  const markup = renderToStaticMarkup(React.createElement(Chart, { source: JSON.stringify({ type: 'line', title: '<script>alert(1)</script>', data: [{ label: '<img src=x>', value: 3 }] }) }));
  assert.match(markup, /<svg/);
  assert.equal(markup.includes('<script>'), false);
  assert.equal(markup.includes('<img src=x>'), false);
  assert.match(markup, /&lt;script&gt;/);
});
