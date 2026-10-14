import type { Action } from '../shared/contracts.ts';
export function validateAction(input: unknown): Action {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Geçersiz işlem.');
  const a = input as Record<string, unknown>;
  const fields: Record<string, string[]> = { snapshot: [], refresh: [], reconnect: [], chooseScope: [], hide: [], quit: [], select: ['key'], create: ['title', 'kind'], send: ['key', 'message'], independent: ['key', 'message'], steer: ['taskId', 'message'], cancel: ['taskId'], workRead: ['taskId'], acceptPlan: ['taskId'], quick:['key','command','app','value','windowId'] };
  if (typeof a.type !== 'string' || !Object.hasOwn(fields, a.type) || Object.keys(a).some(k => k !== 'type' && !fields[a.type as string].includes(k))) throw new Error('İşlem bu istemcide açık değil.');
  for (const k of fields[a.type]) if (typeof a[k] !== 'string' || !(a[k] as string).trim()) throw new Error('Boş veya geçersiz alan.');
  if (a.key && (String(a.key).length > 256 || /[\x00-\x1f]/.test(String(a.key)))) throw new Error('Geçersiz sohbet.');
  if (a.title && (String(a.title).length > 120 || /[\x00-\x1f]/.test(String(a.title)))) throw new Error('Başlık en fazla 120 karakter olmalı.');
  if (a.type === 'create' && a.kind !== 'daily' && a.kind !== 'project') throw new Error('Geçersiz sohbet türü.');
  if (a.message && String(a.message).length > 16000) throw new Error('İleti en fazla 16000 karakter olmalı.');
  if (a.taskId && (String(a.taskId).length > 128 || /[\x00-\x1f]/.test(String(a.taskId)))) throw new Error('Geçersiz görev kimliği.');
  if (a.type === 'steer' && String(a.message).length > 1800) throw new Error('Yönlendirme en fazla 1800 karakter olmalı.');
  if(a.type==='quick') {
    if(!['resolve','open','status','focus','minimize','restore','close','audio_status','volume','mute','media','power_status','power'].includes(String(a.command)) || !['notepad','calculator','paint'].includes(String(a.app)) || String(a.value).length>32 || String(a.windowId).length>128)throw new Error('Dar Windows işlemi gerekli.');
  }
  return a as Action;
}
export function trustedFrame(senderId: number, windowId: number | undefined, frameUrl: string, topFrame: boolean, dev: boolean): boolean {
  if (senderId !== windowId || !topFrame) return false;
  try {
    const url = new URL(frameUrl);
    return dev ? url.origin === 'http://127.0.0.1:5173' && url.pathname === '/' && !url.search : url.protocol === 'jarvis:' && url.host === 'app' && url.pathname === '/' && !url.search;
  } catch { return false; }
}
