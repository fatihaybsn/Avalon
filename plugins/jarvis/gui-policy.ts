import fs from 'node:fs';
import path from 'node:path';
import {exactKeys,text,type Scope} from './policy.ts';
import {operationHash} from './quick-policy.ts';

export const GUI_ROLE='Use direct operations or managed Playwright when sufficient. For general Windows GUI, use the selected native CUA node. Act only within the current user-requested task and an exactly observed window/element. Use a fresh window observation before each input and background delivery only; inspect the same window after uncertain results and never repeat the same action or switch drivers to retry it. Do not invent held keys, drag, coordinate or foreground support. Use selected Windows-MCP tools only for a clear capability gap or fewer calls; do not create a second decision model.';
export const GUI_PREFIX='windows_gui__';
export const GUI_MCP_NAMES=['ControlStatus','Snapshot','Screenshot','Click','Type','Scroll','Move','Shortcut','WaitFor','MultiEdit','MultiSelect'];
export const GUI_READ_NAMES=['ControlStatus','Snapshot','Screenshot','WaitFor'];
export const GUI_COMPUTER_READS=['screenshot','list_windows','list_apps','get_window_state','get_accessibility_tree','get_cursor_position','zoom'];
const GUI_COMPUTER_INPUTS:Record<string,string[]>={
 set_value:['windowRef','elementRef','observationId','value','deliveryMode'],
 type:['windowRef','elementRef','observationId','text','deliveryMode'],
 left_click:['windowRef','elementRef','observationId','deliveryMode'],
 right_click:['windowRef','elementRef','observationId','deliveryMode'],
 double_click:['windowRef','elementRef','observationId','deliveryMode'],
 scroll:['windowRef','elementRef','observationId','scrollDirection','scrollAmount','deliveryMode']
};
const SENSITIVE_CLICK=/\b(pay|checkout|purchase|buy|submit|send|delete|remove|transfer|confirm|approve|publish)\b|ödeme|satın al|gönder|sil|havale|onayla|yayınla/i;
type GuiBounds={x:number;y:number;width:number;height:number};
type GuiElement={elementRef:string;role?:string;label?:string;value?:unknown;bounds?:GuiBounds};
type GuiObservation={windowRef:string;observationId:string;elements:Map<string,GuiElement>};
type Pending={driver:string;action:string;signature:string;windowRef:string;targetRole:string;targetBounds:GuiBounds;expectedValue?:string;typedText?:string;beforeValue?:string};
type RunState={driver?:string;observed?:GuiObservation;pending?:Pending;blocked?:boolean;used:Set<string>};

let selectedNode:string|undefined;
export const configuredGuiNode=()=>selectedNode;
let catalogue=new Map<string,{inputSchema:{properties?:Record<string,unknown>;required?:string[]}}>();
export function configureGuiPolicy(nodeId:unknown,nativeRoot:unknown) {
 if(!/^[a-f0-9]{64}$/.test(String(nodeId)))throw new Error('Exact paired native Windows node ID required');
 const file=path.resolve(String(nativeRoot),'../../config/windows-mcp-tools.json');
 const actual=JSON.parse(fs.readFileSync(file,'utf8'));
 if(actual.version!=='0.8.8'||actual.transport!=='stdio')throw new Error('Pinned real Windows-MCP catalogue required');
 const tools=actual.tools.filter((t:{name:string})=>GUI_MCP_NAMES.includes(t.name));
 if(tools.length!==GUI_MCP_NAMES.length)throw new Error('Selected GUI tool absent from recorded tools/list');
 catalogue=new Map(tools.map((t:{name:string;inputSchema:unknown})=>[GUI_PREFIX+t.name,t]));selectedNode=String(nodeId);
}
export function isGuiTool(name:string){return name==='computer'||GUI_MCP_NAMES.some(n=>name===GUI_PREFIX+n);}
export function isGuiRead(name:string,p:Record<string,unknown>){return name==='computer'?GUI_COMPUTER_READS.includes(String(p.action)):GUI_READ_NAMES.some(n=>name===GUI_PREFIX+n);}
export function guiParams(name:string,p:Record<string,unknown>) {
 if(name==='computer'){
  const action=String(p.action);
  const reads:Record<string,string[]>={screenshot:['screenIndex'],list_apps:[],list_windows:[],get_window_state:['windowRef','includeScreenshot','query','depth','maxElements'],get_accessibility_tree:[],get_cursor_position:[],zoom:['windowRef','observationId','x1','y1','x2','y2']};
  const input=GUI_COMPUTER_INPUTS[action];
  if(!Object.hasOwn(reads,action)&&!input)throw new Error('Unsupported CUA action for this Windows capability');
  exactKeys(p,['action','target','node',...(input??reads[action])]);
  if(p.target!=='node'||!/^[a-f0-9]{64}$/.test(String(p.node))||p.node!==selectedNode)throw new Error('Exact selected native node target required; Gateway desktop or another node is not a substitute');
  if(p.screenIndex!==undefined&&p.screenIndex!==0)throw new Error('Windows descriptor supports primary display only');
  for(const key of ['windowRef','observationId','elementRef'])if(p[key]!==undefined)text(p[key],key,256);
  if(['get_window_state','zoom'].includes(action)&&!p.windowRef)throw new Error('Current native window reference required');
  if(input){
   for(const key of ['windowRef','elementRef','observationId'])text(p[key],key,256);
   if(p.deliveryMode!=='background')throw new Error('Window input requires explicit supported background delivery; foreground is not an automatic fallback');
   if(action==='set_value')text(p.value,'value',4096);
   if(action==='type')text(p.text,'text',4096);
   if(action==='scroll'){
    if(!['up','down','left','right'].includes(String(p.scrollDirection)))throw new Error('Supported scroll direction required');
    if(p.scrollAmount!==undefined&&(!Number.isSafeInteger(p.scrollAmount)||Number(p.scrollAmount)<1||Number(p.scrollAmount)>100))throw new Error('Bounded scroll amount required');
   }
  }
  if(p.includeScreenshot!==undefined&&typeof p.includeScreenshot!=='boolean')throw new Error('Invalid screenshot switch');
  if(p.query!==undefined)text(p.query,'query',128);
  if(p.depth!==undefined&&(!Number.isInteger(p.depth)||Number(p.depth)<0||Number(p.depth)>64))throw new Error('Bounded depth required');
  if(p.maxElements!==undefined&&(!Number.isInteger(p.maxElements)||Number(p.maxElements)<1||Number(p.maxElements)>2000))throw new Error('Bounded element count required');
 }else{
  const tool=catalogue.get(name);if(!tool)throw new Error('Real pinned GUI tool catalogue unavailable');
  if(!isGuiRead(name,p))throw new Error('Windows-MCP input effects remain closed until a specific capability gap is guarded');
  exactKeys(p,Object.keys(tool.inputSchema.properties??{}));
  for(const key of tool.inputSchema.required??[])if(p[key]===undefined)throw new Error('Required catalogue argument missing');
  if(p.use_dom===true||p.use_dom==='true')throw new Error('Second general browser surface is closed');
  if(p.timeout!==undefined&&(!Number.isFinite(p.timeout)||Number(p.timeout)<0||Number(p.timeout)>15))throw new Error('Bounded readiness timeout required');
  if(p.interval!==undefined&&(!Number.isFinite(p.interval)||Number(p.interval)<0.1||Number(p.interval)>5))throw new Error('Bounded readiness interval required');
  if(p.condition!==undefined)text(p.condition,'readiness condition',128);
 }
 return structuredClone(p);
}
export function guiTaskAuthorized(name:string,p:Record<string,unknown>,scope:Scope){
 return scope.role==='project'&&(Boolean(scope.userStatement)||Boolean(scope.quick?.some(g=>g.tool===name&&operationHash(g.params)===operationHash(p))));
}
export async function guiDecision(name:string,input:Record<string,unknown>,scope:Scope) {
 if(!selectedNode)throw new Error('Native GUI node is not configured/verified');
 const p=guiParams(name,input);
 if(name==='computer'&&p.node!==selectedNode)throw new Error('Different device/node is outside this GUI configuration');
 if(!guiTaskAuthorized(name,p,scope))throw new Error('Current authenticated user task must authorize GUI input');
 const {localCall}=await import('./quick.ts');
 const activity=await localCall('activity',{});
 if(activity.interactive!==true)throw new Error('Gateway/MCP is outside the interactive Windows desktop; no service/session-zero GUI assumption');
 return {params:p};
}
function asGuiRecord(value:unknown):Record<string,any>|undefined {
 if(typeof value==='string')try{return asGuiRecord(JSON.parse(value));}catch{return undefined;}
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const record=value as Record<string,any>;
 if(record.structuredContent&&typeof record.structuredContent==='object')return {...record,...record.structuredContent};
 if(Array.isArray(record.content))for(const item of record.content)if(typeof item?.text==='string'){
  const parsed=asGuiRecord(item.text);if(parsed)return {...record,...parsed};
 }
 return record;
}
function isFreshGuiObservation(name:string,p:Record<string,unknown>){
 return name==='computer'?String(p.action)==='get_window_state':[`${GUI_PREFIX}Snapshot`,`${GUI_PREFIX}Screenshot`].includes(name);
}
function actionSignature(name:string,p:Record<string,unknown>,target?:GuiElement){
 const stable={...p};delete stable.observationId;delete stable.executionId;
 if(target){delete stable.elementRef;stable.observedTarget={role:target.role,bounds:target.bounds};}
 return `${name}:${operationHash(stable)}`;
}
function parseBounds(value:unknown):GuiBounds|undefined{
 if(!value||typeof value!=='object')return undefined;
 const b=value as Record<string,unknown>;
 if(!['x','y','width','height'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])))return undefined;
 if(Number(b.width)<0||Number(b.height)<0)return undefined;
 return {x:Number(b.x),y:Number(b.y),width:Number(b.width),height:Number(b.height)};
}
function sameBounds(a:GuiBounds|undefined,b:GuiBounds|undefined){return Boolean(a&&b&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height);}
function observationFrom(result:Record<string,any>,windowRef:string):GuiObservation|undefined{
 const raw=result.observation??result.details?.observation;
 if(!raw||typeof raw.observationId!=='string'||!Array.isArray(raw.elements))return undefined;
 const elements=new Map<string,GuiElement>();
 for(const item of raw.elements)if(item&&typeof item.elementRef==='string')elements.set(item.elementRef,{elementRef:item.elementRef,role:typeof item.role==='string'?item.role:undefined,label:typeof item.label==='string'?item.label:undefined,value:item.value,bounds:parseBounds(item.bounds)});
 return {windowRef,observationId:raw.observationId,elements};
}
function inputValue(element:GuiElement){return typeof element.value==='string'?element.value:undefined;}

// One ephemeral observation per task. Uncertain actions must be inspected in
// the same window before continuing; their exact operation cannot be replayed.
export class GuiObservations {
 private state=new Map<string,RunState>();
 before(run:string,name:string,p:Record<string,unknown>){
  const driver=name==='computer'?'cua':'mcp';let state=this.state.get(run);if(!state){state={used:new Set()};this.state.set(run,state);}
  const read=isGuiRead(name,p),action=String(p.action);
  if(state.blocked&&!read)throw new Error('GUI action could not be verified; inspect and report, do not retry');
  if(state.pending){
   if(!read)throw new Error('Previous GUI action is uncertain; inspect the same window before continuing');
   if(driver!==state.pending.driver)throw new Error('Inspect an uncertain GUI action with its original driver; no cross-driver retry');
   if(name==='computer'&&(action!=='get_window_state'||p.windowRef!==state.pending.windowRef))throw new Error('Inspect the exact window affected by the previous GUI action');
  }
  if(state.driver&&state.driver!==driver&&!read)throw new Error('Driver change requires fresh native observation; old references cannot cross drivers');
  if(read){state.observed=undefined;state.driver=driver;return;}
  const observed=state.observed;
  if(!observed)throw new Error('Fresh CUA window observation required before input');
  if(driver!=='cua'||p.windowRef!==observed.windowRef||p.observationId!==observed.observationId||typeof p.elementRef!=='string'||!observed.elements.has(p.elementRef))throw new Error('Input must target a window and element from the latest CUA observation');
  const element=observed.elements.get(p.elementRef)!;
  if(['set_value','type'].includes(action)&&!['Edit','ComboBox','TextBox'].includes(String(element.role)))throw new Error('Text input may target only an observed editable element');
  if(['left_click','right_click','double_click'].includes(action)&&SENSITIVE_CLICK.test(element.label??''))throw new Error('This button may submit, delete, pay or approve; the separate manual approval path is required');
  if(!element.role||!element.bounds)throw new Error('Observed target needs a role and exact bounds for same-window verification');
  const signature=actionSignature(name,p,element);if(state.used.has(signature))throw new Error('This exact GUI action was already attempted in this task; do not repeat it');
  state.used.add(signature);state.pending={driver,action,signature,windowRef:observed.windowRef,targetRole:element.role,targetBounds:element.bounds,...(action==='set_value'?{expectedValue:String(p.value)}:{}),...(action==='type'?{typedText:String(p.text),beforeValue:inputValue(element)}:{})};
  state.observed=undefined;state.driver=driver;
 }
 after(run:string,name:string,p:Record<string,unknown>,result:unknown,error?:string){
  const state=this.state.get(run);if(!state)return;
  const mutation=!isGuiRead(name,p);
  if(error||result===undefined){if(mutation)state.pending??=undefined;state.observed=undefined;state.blocked=true;return;}
  const r=asGuiRecord(result);
  if(!r||r.isError||r.details?.isError||r.error){if(mutation)state.blocked=true;state.observed=undefined;return;}
  const control=r.state??r.details?.state;
  if(control&&control!=='ready'){state.blocked=true;state.observed=undefined;return;}
  if(!mutation){
   if(!isFreshGuiObservation(name,p)){state.observed=undefined;return;}
   const observation=observationFrom(r,String(p.windowRef));
   if(!observation){if(state.pending)state.blocked=true;state.observed=undefined;return;}
   if(state.pending){
    const pending=state.pending,candidates=[...observation.elements.values()].filter(e=>e.role===pending.targetRole&&sameBounds(e.bounds,pending.targetBounds)),element=candidates.length===1?candidates[0]:undefined,value=element?inputValue(element):undefined;
    const verified=pending.expectedValue!==undefined?value===pending.expectedValue:pending.typedText!==undefined?value!==pending.beforeValue&&value?.includes(pending.typedText):true;
    if(!verified){state.blocked=true;state.pending=undefined;state.observed=undefined;return;}
    state.pending=undefined;
   }
   state.observed=observation;state.driver=name==='computer'?'cua':'mcp';return;
  }
  const effect=r.effect??r.details?.effect,delivery=r.details?.deliveryMode??r.deliveryMode;
  if(effect==='confirmed'&&delivery==='background')state.pending=undefined;
  // The driver often cannot certify app-specific background delivery. Require
  // a fresh same-window observation; the action signature prevents a replay.
  state.observed=undefined;
 }
 release(run:string){this.state.delete(run);}
}
