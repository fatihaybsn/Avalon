import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, protocol, session, safeStorage, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProfile } from './profile.ts';
import { DeviceVault } from './vault.ts';
import { Gateway } from './gateway.ts';
import { DesktopController } from './controller.ts';
import { trustedFrame, validateAction } from './validation.ts';
import type { Snapshot, Result } from '../shared/contracts.ts';

protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.enableSandbox();
// Stable development/package identity. Credentials never depend on a renderer.
app.setPath('userData', path.join(app.getPath('appData'), 'jarvis-desktop'));
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let exiting = false;
let controller: DesktopController;
let gateway: Gateway | undefined;
const dev = !app.isPackaged && process.env.JARVIS_DESKTOP_DEV === '1';
const url = dev ? 'http://127.0.0.1:5173/' : 'jarvis://app/';
// Gateway, device credentials and future stage-11 voice ownership belong to the
// app lifetime, independently of BrowserWindow visibility/render reloads.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.on('before-quit', () => { exiting = true; controller?.stop(); gateway?.stop(); tray?.destroy(); });
  app.on('window-all-closed', () => {});
  app.whenReady().then(initialize).catch(() => {
    dialog.showErrorBox('JARVIS', 'Masaüstü istemcisi başlatılamadı. Profil ve derleme düzenini kontrol edin.'); app.quit();
  });
}

function broadcast(snapshot: Snapshot) {
  if (window && !window.isDestroyed() && trustedFrame(window.webContents.id, window.webContents.id, window.webContents.getURL(), true, dev)) window.webContents.send('jarvis:snapshot', snapshot);
}
async function initialize() {
  const rendererRoot = path.join(__dirname, 'renderer');
  const ses = session.fromPartition('jarvis-desktop');
  await ses.protocol.handle('jarvis', async request => {
    const u = new URL(request.url);
    if (u.host !== 'app' || request.method !== 'GET' || u.search) return new Response('', { status: 403 });
    let requested: string;
    try { requested = decodeURIComponent(u.pathname); } catch { return new Response('', { status: 400 }); }
    if (requested.includes('\\') || requested.includes('\0')) return new Response('', { status: 403 });
    const file = path.resolve(rendererRoot, requested === '/' ? 'index.html' : `.${requested}`);
    const relative = path.relative(rendererRoot, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Response('', { status: 403 });
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
    if (!mime[path.extname(file)]) return new Response('', { status: 403 });
    try { return new Response(await fs.readFile(file), { headers: { 'Content-Type': mime[path.extname(file)], 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } }); }
    catch { return new Response('', { status: 404 }); }
  });
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', e => e.preventDefault());
  // Renderer network stays local; the Gateway socket lives only in main.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = new URL(details.url);
    const allowed = u.protocol === 'jarvis:' && u.host === 'app' || dev && ['http:', 'ws:'].includes(u.protocol) && u.host === '127.0.0.1:5173';
    callback({ cancel: !allowed });
  });
  const disconnected = { connected: false, request: async () => { throw new Error('Gateway unavailable'); } };
  controller = new DesktopController(disconnected, 'main', broadcast);
  try {
    const profile = await loadProfile();
    const vault = new DeviceVault(path.join(app.getPath('userData'), 'device.dpapi'), safeStorage, profile.url);
    gateway = new Gateway(profile, vault, s => controller.connection(s), () => controller.connected(), (event, payload) => controller.event(event, payload));
    controller = new DesktopController(gateway, profile.agentId, broadcast);
  } catch {
    controller.connection({ phase: 'blocked', detail: 'JARVIS profili veya kullanıcı token başvurusu doğrulanamadı. Profil kurulumunu kontrol edin.' });
  }
  ipcMain.handle('jarvis:action', async (event, input): Promise<Result> => {
    if (!trustedFrame(event.sender.id, window?.webContents.id, event.senderFrame?.url ?? '', event.senderFrame === window?.webContents.mainFrame, dev)) throw new Error('IPC sender rejected');
    try {
      const action = validateAction(input);
      switch (action.type) {
        case 'snapshot': break;
        case 'refresh': controller.snapshot.error = undefined; await controller.refresh(); break;
        case 'reconnect': if (gateway) await gateway.start(); break;
        case 'select': await controller.select(action.key); break;
        case 'create': await controller.create(action.title, action.kind); break;
        case 'send': await controller.send(action.key, action.message); break;
        case 'quick': await controller.quick(action); break;
        case 'independent': await controller.independent(action.key, action.message); break;
        case 'steer': await controller.workAction('steer', action.taskId, action.message); break;
        case 'cancel': await controller.workAction('cancel', action.taskId); break;
        case 'workRead': await controller.workAction('workRead', action.taskId); break;
        case 'acceptPlan': await controller.workAction('acceptPlan', action.taskId); break;
        case 'chooseScope': {
          const key = controller.snapshot.selected;
          if (!key || !window) throw new Error('No selected session');
          const selection = await dialog.showOpenDialog(window, { title: 'Bu sohbetteki dosya görevi için izin kökü', buttonLabel: 'Bu klasöre izin ver', properties: ['openDirectory'], message: 'Yalnız bu sohbette gönderilecek görevlerin dosya kapsamını seçin. Host politikası korunan yolları ayrıca denetler.' });
          if (!selection.canceled && selection.filePaths.length === 1) controller.setRoot(key, selection.filePaths[0]);
          break;
        }
        case 'hide': window?.hide(); break;
        case 'quit': app.quit(); break;
      }
      return { ok: true, snapshot: structuredClone(controller.snapshot) };
    } catch (error) {
      controller.showError(error);
      return { ok: false, error: controller.snapshot.error ?? 'İşlem başarısız.', snapshot: structuredClone(controller.snapshot) };
    }
  });
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('JARVIS');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'JARVIS’i göster', click: () => { if (!window || window.isDestroyed()) createWindow(); window?.show(); window?.focus(); } },
    { type: 'separator' }, { label: 'Uygulamadan çık', click: () => app.quit() }
  ]));
  tray.on('double-click', () => { window?.show(); window?.focus(); });
  void gateway?.start();
}
function createWindow() {
  window = new BrowserWindow({ width: 1160, height: 800, minWidth: 760, minHeight: 560, title: 'JARVIS', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, partition: 'jarvis-desktop' }
  });
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.on('will-frame-navigate', e => e.preventDefault());
  window.webContents.on('will-redirect', e => e.preventDefault());
  window.webContents.on('will-attach-webview', e => e.preventDefault());
  window.on('close', e => { if (!exiting) { e.preventDefault(); window?.hide(); } });
  window.once('ready-to-show', () => window?.show());
  void window.loadURL(url);
}
