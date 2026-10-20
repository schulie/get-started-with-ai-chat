require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {create,act}=require('react-test-renderer');
const {Dictation}=require('../src/components/agents/chatbot/Dictation.tsx');
const {ReadAloud,speechText}=require('../src/components/agents/chatbot/ReadAloud.tsx');
global.IS_REACT_ACT_ENVIRONMENT=true;
function setup(){
  global.window=new EventTarget();global.document=new EventTarget();document.hidden=false;
  let stopped=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  Object.defineProperty(global,'navigator',{value:{mediaDevices:{getUserMedia:async()=>stream}},configurable:true});
  global.MediaRecorder=class {
    static isTypeSupported(type){return type.startsWith('audio/webm');}
    constructor(){this.state='inactive';this.mimeType='audio/webm';global.recorder=this;}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['synthetic audio'])});this.onstop();}
  };
  return ()=>stopped;
}
test('dictation waits for explicit Transcribe, returns editable text, and stops tracks',async()=>{
  const stopped=setup(),calls=[],texts=[];
  global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({text:'Synthetic dictated text'}));};
  let root;
  await act(async()=>{root=create(React.createElement(Dictation,{disabled:false,onText:t=>texts.push(t),onBusy:()=>{}}));});
  const button=name=>root.root.findAllByType('button').find(node=>node.props.children===name);
  await act(async()=>button('Mic').props.onClick());
  assert.equal(calls.length,0);
  await act(async()=>button('Finish recording').props.onClick());
  assert.ok(stopped()>0);assert.equal(calls.length,0);
  await act(async()=>button('Transcribe').props.onClick());
  assert.equal(calls[0].url,'/api/dictation');assert.equal(calls[0].body.name,'dictation.webm');
  assert.deepEqual(texts,['Synthetic dictated text']);
  await act(async()=>root.unmount());
});
test('clearing or hiding a recording discards it and ignores a late transcription',async()=>{
  const stopped=setup(),texts=[];let resolve;
  global.fetch=()=>new Promise(done=>resolve=done);
  let root;
  await act(async()=>{root=create(React.createElement(Dictation,{disabled:false,onText:t=>texts.push(t),onBusy:()=>{}}));});
  const button=name=>root.root.findAllByType('button').find(node=>node.props.children===name);
  await act(async()=>button('Mic').props.onClick());
  await act(async()=>button('Finish recording').props.onClick());
  await act(async()=>button('Transcribe').props.onClick());
  await act(async()=>root.unmount());
  await act(async()=>resolve(new Response(JSON.stringify({text:'Must not reappear'}))));
  assert.deepEqual(texts,[]);assert.ok(stopped()>0);
});
test('read aloud uses only local voices and cancels on session unmount',async()=>{
  setup();let cancelled=0;const spoken=[];
  const synth=new EventTarget();synth.getVoices=()=>[{name:'Remote',lang:'en-US',localService:false},{name:'Device',lang:'en-US',localService:true}];
  synth.speak=value=>spoken.push(value);synth.cancel=()=>cancelled++;window.speechSynthesis=synth;
  global.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  let root;
  await act(async()=>{root=create(React.createElement(ReadAloud,{text:'**Synthetic answer** [source](https://example.com)'}));});
  const button=root.root.findAllByType('button')[0];
  await act(async()=>button.props.onClick());
  assert.ok(spoken.length);assert.equal(spoken[0].voice.name,'Device');assert.ok(!spoken[0].text.includes('https'));
  await act(async()=>root.unmount());assert.ok(cancelled>0);
  assert.equal(speechText('```js\nsecret code\n``` **Hello**'),'Code block omitted. Hello');
});
