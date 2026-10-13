import { contextBridge, ipcRenderer } from 'electron';
import type { Action, Snapshot, DesktopBridge } from '../shared/contracts.ts';
const bridge: DesktopBridge = Object.freeze({
  action: (action: Action) => ipcRenderer.invoke('jarvis:action', action),
  subscribe: (listener: (snapshot: Snapshot) => void) => {
    const handler = (_event: unknown, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on('jarvis:snapshot', handler);
    return () => ipcRenderer.removeListener('jarvis:snapshot', handler);
  }
});
contextBridge.exposeInMainWorld('jarvis', bridge);
