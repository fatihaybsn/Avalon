import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { configureGuiPolicy, guiParams, guiTaskAuthorized, GuiObservations, GUI_PREFIX, GUI_MCP_NAMES } from '../plugins/jarvis/gui-policy.ts';
import { makeScope } from '../plugins/jarvis/policy.ts';

const node='a'.repeat(64);
configureGuiPolicy(node,path.resolve('native/windows'));
const identity={userId:'operator',deviceId:'device',agentId:'main',sessionId:'session',sessionKey:'agent:main:gui-test'};
const base={runId:'gui-run',taskId:'gui-task',projectId:'gui-project',role:'project',root:process.cwd()};
const state={action:'get_window_state',target:'node',node,windowRef:'window-1',includeScreenshot:false};
const write={action:'set_value',target:'node',node,windowRef:'window-1',elementRef:'element-1',observationId:'observation-1',value:'approved text',deliveryMode:'background'};
const bounds={x:10,y:20,width:300,height:32};
const observation=(value,id='observation-1',elementRef='element-1')=>({observation:{observationId:id,elements:[{elementRef,role:'Edit',label:'Name',value,bounds}]}});

test('CUA reads and one-window background inputs are pinned to the selected native node',()=>{
 assert.deepEqual(guiParams('computer',state),state);
 assert.deepEqual(guiParams('computer',{action:'get_accessibility_tree',target:'node',node}),{action:'get_accessibility_tree',target:'node',node});
 assert.deepEqual(guiParams('computer',write),write);
 for(const invalid of [
  {...state,target:'gateway'},
  {...state,node:'b'.repeat(64)},
  {...write,deliveryMode:'foreground'},
  {...write,observationId:undefined},
  {...write,windowRef:undefined},
  {...write,coordinate:[10,20]},
  {action:'left_click_drag',target:'node',node,windowRef:'window-1',elementRef:'element-1',observationId:'observation-1',deliveryMode:'background'},
  {action:'key',target:'node',node,windowRef:'window-1',elementRef:'element-1',observationId:'observation-1',text:'ctrl+v',deliveryMode:'background'},
  {action:'screenshot',target:'node',node,screenIndex:1}
 ]) assert.throws(()=>guiParams('computer',invalid));
});

test('Windows-MCP uses only names and read schemas present in the pinned 0.8.8 catalogue',()=>{
 assert.deepEqual(GUI_MCP_NAMES,['ControlStatus','Snapshot','Screenshot','Click','Type','Scroll','Move','Shortcut','WaitFor','MultiEdit','MultiSelect']);
 assert.deepEqual(guiParams(`${GUI_PREFIX}Snapshot`,{use_vision:true,use_dom:false,display:[0]}),{use_vision:true,use_dom:false,display:[0]});
 assert.deepEqual(guiParams(`${GUI_PREFIX}WaitFor`,{condition:'active_window',timeout:5,interval:0.5}),{condition:'active_window',timeout:5,interval:0.5});
 for(const name of ['Click','Type','Scroll','Move','Shortcut','MultiEdit','MultiSelect']) assert.throws(()=>guiParams(`${GUI_PREFIX}${name}`,{}),/remain closed/);
 assert.throws(()=>guiParams(`${GUI_PREFIX}NotARealTool`,{}),/catalogue/);
 assert.throws(()=>guiParams(`${GUI_PREFIX}Snapshot`,{use_dom:true}),/browser surface/);
 assert.throws(()=>guiParams(`${GUI_PREFIX}WaitFor`,{condition:'active_window',timeout:16}),/timeout/);
});

test('CUA mutations require an authenticated current project task, not a research or empty scope',async()=>{
 const task=await makeScope({...base,userInput:'Fill the observed test-window field with approved text.'},identity);
 assert.equal(guiTaskAuthorized('computer',write,task),true);
 const empty=await makeScope(base,identity);
 assert.equal(guiTaskAuthorized('computer',write,empty),false);
 const memory=await makeScope({runId:'memory-run',taskId:'memory-task',projectId:'gui-project',role:'memory',userInput:'Fill the test field.'},identity);
 assert.equal(guiTaskAuthorized('computer',write,memory),false);
 const exact=await makeScope({...base,runId:'exact-run',quick:[{tool:'computer',params:write}]},identity);
 assert.equal(guiTaskAuthorized('computer',write,exact),true);
});

test('an uncertain write is read back in the same window before a different action can proceed',()=>{
 const guard=new GuiObservations(),read={action:'get_window_state',windowRef:'window-1'};
 assert.throws(()=>guard.before('run-a','computer',write),/Fresh CUA window observation/);
 guard.before('run-a','computer',read);guard.after('run-a','computer',read,observation('old'));
 guard.before('run-a','computer',write);
 guard.after('run-a','computer',write,{ok:true,effect:'unverifiable',details:{deliveryMode:'unknown'}});
 assert.throws(()=>guard.before('run-a','computer',{...write,value:'retry'}),/uncertain/);
 guard.before('run-a','computer',read);guard.after('run-a','computer',read,observation('approved text','observation-2','element-after-write'));
 const next={...write,elementRef:'element-after-write',observationId:'observation-2',value:'next task value'};
 assert.doesNotThrow(()=>guard.before('run-a','computer',next));
 guard.after('run-a','computer',next,{effect:'confirmed',details:{deliveryMode:'background'}});
 guard.before('run-a','computer',{...read});guard.after('run-a','computer',{...read},observation('next task value','observation-3','element-after-next'));
 assert.throws(()=>guard.before('run-a','computer',{...next,elementRef:'element-after-next',observationId:'observation-3'}),/already attempted/);
});

test('a failed text readback holds the task, and a sensitive button is refused',()=>{
 const guard=new GuiObservations(),read={action:'get_window_state',windowRef:'window-1'};
 guard.before('run-b','computer',read);guard.after('run-b','computer',read,observation('old'));
 guard.before('run-b','computer',write);guard.after('run-b','computer',write,{effect:'unverifiable',details:{deliveryMode:'unknown'}});
 guard.before('run-b','computer',read);guard.after('run-b','computer',read,observation('different text'));
 assert.throws(()=>guard.before('run-b','computer',{...write,value:'another value',observationId:'observation-2'}),/could not be verified/);

 const buttonRead={action:'get_window_state',windowRef:'window-2'};
 guard.before('run-c','computer',buttonRead);
 guard.after('run-c','computer',buttonRead,{observation:{observationId:'obs-button',elements:[{elementRef:'send-button',role:'Button',label:'Send payment'}]}});
 assert.throws(()=>guard.before('run-c','computer',{action:'left_click',windowRef:'window-2',elementRef:'send-button',observationId:'obs-button',deliveryMode:'background'}),/manual approval/);
});

test('same-window readback accepts a new elementRef only for one exact role-and-bounds match',()=>{
 const guard=new GuiObservations(),read={action:'get_window_state',windowRef:'window-1'};
 guard.before('run-bounds','computer',read);guard.after('run-bounds','computer',read,observation('old'));
 guard.before('run-bounds','computer',write);guard.after('run-bounds','computer',write,{effect:'unverifiable',details:{deliveryMode:'unknown'}});
 guard.before('run-bounds','computer',read);
 const ambiguous={observation:{observationId:'observation-2',elements:[
  {elementRef:'fresh-1',role:'Edit',label:'Name',value:'approved text',bounds},
  {elementRef:'fresh-2',role:'Edit',label:'Other',value:'approved text',bounds}
 ]}};
 guard.after('run-bounds','computer',read,ambiguous);
 assert.throws(()=>guard.before('run-bounds','computer',{...write,elementRef:'fresh-1',observationId:'observation-2',value:'next'}),/could not be verified/);

 const unique=new GuiObservations();
 unique.before('run-bounds-unique','computer',read);unique.after('run-bounds-unique','computer',read,observation('old'));
 unique.before('run-bounds-unique','computer',write);unique.after('run-bounds-unique','computer',write,{effect:'unverifiable',details:{deliveryMode:'unknown'}});
 unique.before('run-bounds-unique','computer',read);
 unique.after('run-bounds-unique','computer',read,observation('approved text','observation-2','fresh-ref'));
 assert.doesNotThrow(()=>unique.before('run-bounds-unique','computer',{...write,elementRef:'fresh-ref',observationId:'observation-2',value:'next'}));
});

test('confirmed input consumes its observation, and driver changes require a fresh observation',()=>{
 const guard=new GuiObservations(),read={action:'get_window_state',windowRef:'window-1'},write1={...write,value:'first'};
 guard.before('run-d','computer',read);guard.after('run-d','computer',read,observation('old'));
 guard.before('run-d','computer',write1);guard.after('run-d','computer',write1,{effect:'confirmed',details:{deliveryMode:'background'}});
 assert.throws(()=>guard.before('run-d','computer',{...write,value:'second',observationId:'observation-2'}),/Fresh CUA window observation/);
 guard.before('run-d','computer',read);guard.after('run-d','computer',read,observation('first','observation-2'));
 assert.throws(()=>guard.before('run-d',`${GUI_PREFIX}Click`,{}),/Driver change requires fresh/);
});
