require('./register.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {getEventListeners}=require('node:events');
const React=require('react');
const {create,act}=require('react-test-renderer');
const {useViewportHeight}=require('../src/components/agents/hooks/useViewportHeight.ts');
global.IS_REACT_ACT_ENVIRONMENT=true;

async function mount(viewport) {
  const previousWindow=global.window;
  const events=new EventTarget();
  events.visualViewport=viewport;
  global.window=events;
  let height,root;
  function Harness(){height=useViewportHeight();return null;}
  await act(async()=>{root=create(React.createElement(Harness));});
  return {events,get height(){return height;},async close(){await act(async()=>root.unmount());global.window=previousWindow;}};
}

test('visible height follows keyboard and window resizing; unmount removes listeners',async()=>{
  const viewport=Object.assign(new EventTarget(),{height:740,scale:1});
  const app=await mount(viewport);
  try {
    assert.equal(app.height,740);
    await act(async()=>{viewport.height=360;viewport.dispatchEvent(new Event('resize'));});
    assert.equal(app.height,360);
    await act(async()=>{viewport.height=568;app.events.dispatchEvent(new Event('resize'));});
    assert.equal(app.height,568);
    assert.equal(getEventListeners(viewport,'resize').length,1);
    assert.equal(getEventListeners(app.events,'resize').length,1);
  } finally {await app.close();}
  assert.equal(getEventListeners(viewport,'resize').length,0);
  assert.equal(getEventListeners(app.events,'resize').length,0);
});

test('pinch zoom leaves sizing to CSS and restores the visible height at normal scale',async()=>{
  const viewport=Object.assign(new EventTarget(),{height:740,scale:1});
  const app=await mount(viewport);
  try {
    await act(async()=>{viewport.height=370;viewport.scale=2;viewport.dispatchEvent(new Event('resize'));});
    assert.equal(app.height,undefined);
    await act(async()=>{viewport.height=740;viewport.scale=1;viewport.dispatchEvent(new Event('resize'));});
    assert.equal(app.height,740);
  } finally {await app.close();}
});

test('browsers without VisualViewport and transient zero heights use the CSS fallback',async()=>{
  const app=await mount(undefined);
  try {
    assert.equal(app.height,undefined);
    await act(async()=>app.events.dispatchEvent(new Event('resize')));
    assert.equal(app.height,undefined);
  } finally {await app.close();}
  const viewport=Object.assign(new EventTarget(),{height:0,scale:1});
  const zero=await mount(viewport);
  try {assert.equal(zero.height,undefined);}finally{await zero.close();}
});
