require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { renderToStaticMarkup } = require('react-dom/server');
const { ChatInput } = require('../src/components/agents/chatbot/ChatInput.tsx');
const { Chart } = require('../src/components/core/Chart.tsx');
global.IS_REACT_ACT_ENVIRONMENT = true;

test('Video accepts a local clip and submits analysis through chat without a generation promise', async () => {
  const calls=[], sent=[];
  global.fetch=async url => { calls.push(url); return new Response(JSON.stringify({capabilities:['chat','vision'],videoAnalysis:true})); };
  let root;
  await act(async () => { root=create(React.createElement(ChatInput,{isGenerating:false,onSubmit:(...args)=>sent.push(args)})); });
  try {
    await act(async () => root.root.findAllByType('button').find(button=>button.props.children==='Video').props.onClick());
    const input=root.root.findByType('input');
    assert.equal(input.props.multiple,false);
    assert.ok(input.props.accept.includes('.mp4'));
    const file=new File(['synthetic clip'],'synthetic.mp4');
    await act(async () => input.props.onChange({target:{files:[file],value:''}}));
    assert.deepEqual(calls,['/api/capabilities']);
    assert.equal(sent.length,0);
    await act(async () => root.root.findAllByType('button').find(button=>button.props['aria-label']==='Send message').props.onClick());
    assert.equal(sent.length,1);
    assert.equal(sent[0][1].mode,'chat');
    assert.equal(sent[0][1].files[0],file);
    assert.match(sent[0][0],/sampling limitations/);
  } finally { await act(async () => root.unmount()); }
});

test('starter drafts submit once and composition Enter never sends', async () => {
  global.fetch = async () => new Response(JSON.stringify({capabilities: ['chat']}));
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
  const calls = [];
  global.fetch = async (url) => { calls.push(url); return new Response(JSON.stringify({capabilities: ['chat', 'images']})); };
  let root;
  await act(async () => { root = create(React.createElement(ChatInput, { isGenerating: false, onSubmit: value => sent.push(value) })); });
  try {
    const input = root.root.findByType('input');
    await act(async () => input.props.onChange({ target: { files: [{ name: 'synthetic.csv', size: 20, text: async () => 'Group,Count\nA,3' }], value: '' } }));
    assert.equal(sent.length, 0);
    assert.equal(root.root.findByType('textarea').props.value, '');
    assert.deepEqual(calls, ['/api/capabilities']);
    assert.equal(root.root.findAllByType('li')[0].findByType('span').props.children, 'synthetic.csv');
    const send = root.root.findAllByType('button').find(button => button.props['aria-label'] === 'Send message');
    await act(async () => send.props.onClick());
    assert.equal(sent[0], 'Review the attached sources and explain their contents.');
  } finally { await act(async () => root.unmount()); }
});

test('public mode has a compact data label without beta branding and attaches only an explicit URL', async () => {
  const sent = [];
  global.fetch = async () => new Response(JSON.stringify({capabilities: ['chat'], dataMode: 'non_sensitive_beta', webEnabled: true}));
  let root;
  await act(async () => { root = create(React.createElement(ChatInput, {isGenerating: false, onSubmit: (...args) => sent.push(args)})); });
  try {
    const send = () => root.root.findAllByType('button').find(button => button.props['aria-label'] === 'Send message');
    await act(async () => root.root.findAllByType('button').find(button => button.props.children === 'Web').props.onClick());
    const url = root.root.findByType('textarea');
    await act(async () => url.props.onChange({target: {value: 'https://example.com/'}}));
    assert.equal(root.root.findAllByType('input').some(input => input.props.type === 'checkbox'), false);
    assert.equal(root.root.findAllByProps({role:'note'}).length,1);
    assert.equal(root.root.findByProps({role:'note'}).props.children,'Public information only');
    assert.equal(send().props.disabled, false);
    await act(async () => send().props.onClick());
    assert.deepEqual(sent[0][1].webUrls, ['https://example.com/']);
    assert.equal(root.root.findByType('textarea').props.value, '');
    assert.equal(root.root.findAllByType('button').find(button => button.props.children === 'Auto').props['aria-pressed'], true);
  } finally { await act(async () => root.unmount()); }
});

test('touch keyboard Enter adds a line; explicit Send still submits the draft', async () => {
  const previousWindow=global.window;
  global.window={matchMedia:()=>({matches:true})};
  global.fetch=async()=>new Response(JSON.stringify({capabilities:['chat']}));
  const sent=[];
  let root, prevented=false;
  try {
    await act(async()=>{root=create(React.createElement(ChatInput,{isGenerating:false,onSubmit:value=>sent.push(value)}));});
    await act(async()=>root.root.findByType('textarea').props.onChange({target:{value:'First line'}}));
    await act(async()=>root.root.findByType('textarea').props.onKeyDown({key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},preventDefault(){prevented=true;}}));
    assert.equal(prevented,false);
    assert.equal(sent.length,0);
    await act(async()=>root.root.findAllByType('button').find(button=>button.props['aria-label']==='Send message').props.onClick());
    assert.deepEqual(sent,['First line']);
  } finally {
    if(root)await act(async()=>root.unmount());
    global.window=previousWindow;
  }
});

test('Web uses the one message box and returns to Chat before follow-ups', async () => {
  const sent = [];
  global.fetch = async () => new Response(JSON.stringify({capabilities:['chat'],webEnabled:true}));
  let root;
  await act(async () => { root=create(React.createElement(ChatInput,{isGenerating:false,onSubmit:(...args)=>sent.push(args)})); });
  try {
    await act(async () => root.root.findAllByType('button').find(button => button.props.children==='Web').props.onClick());
    await act(async () => root.root.findByType('textarea').props.onChange({target:{value:'public search query'}}));
    await act(async () => root.root.findAllByType('button').find(button => button.props['aria-label']==='Send message').props.onClick());
    assert.deepEqual(sent[0],['public search query',{mode:'chat',webQuery:'public search query'}]);
    await act(async () => root.root.findByType('textarea').props.onChange({target:{value:'Follow up'}}));
    await act(async () => root.root.findAllByType('button').find(button => button.props['aria-label']==='Send message').props.onClick());
    assert.equal(sent[1][1].webQuery,undefined);
  } finally { await act(async () => root.unmount()); }
});

test('drop and paste attach locally; switching tools cannot silently discard files', async () => {
  const calls=[];
  global.fetch=async url => { calls.push(url); return new Response(JSON.stringify({capabilities:['chat','images']})); };
  let root;
  await act(async () => { root=create(React.createElement(ChatInput,{isGenerating:false,onSubmit:()=>{}})); });
  try {
    const file=new File(['Synthetic'],'sample.txt');
    const composer=root.root.findAllByType('div').find(node=>node.props.onDrop);
    await act(async () => composer.props.onDrop({preventDefault(){},dataTransfer:{files:[file]}}));
    await act(async () => root.root.findAllByType('button').find(button=>button.props.children==='Image').props.onClick());
    assert.equal(root.root.findAllByType('li').length,1);
    assert.match(root.root.findByProps({role:'alert'}).children.join(''),/Remove the attached files/);
    await act(async () => root.root.findByType('textarea').props.onPaste({preventDefault(){},clipboardData:{items:[{kind:'file',getAsFile:()=>new File(['x'],'paste.png')}]}}));
    assert.equal(root.root.findAllByType('li').length,2);
    assert.deepEqual(calls,['/api/capabilities']);
  } finally { await act(async () => root.unmount()); }
});
test('chart labels remain escaped data in SVG output', () => {
  const markup = renderToStaticMarkup(React.createElement(Chart, { source: JSON.stringify({ type: 'line', title: '<script>alert(1)</script>', data: [{ label: '<img src=x>', value: 3 }] }) }));
  assert.match(markup, /<svg/);
  assert.equal(markup.includes('<script>'), false);
  assert.equal(markup.includes('<img src=x>'), false);
  assert.match(markup, /&lt;script&gt;/);
});
