// Desktop wrapper: the same page as the website, in its own window. It is served from app://game/ (a secure origin of
// its own) so IndexedDB keeps the player's ROM between runs and the sound's AudioWorklet runs, as on https.
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('path'), url = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true, backgroundColor: '#11152b',
    title: '3D Sonic 3D Blast 3D', webPreferences: { contextIsolation: true, sandbox: true } });
  // links (GitHub, the chili dog meter) open in the player's browser
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (/^https?:/.test(u)) { e.preventDefault(); shell.openExternal(u); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.loadURL('app://game/index.html');
  return win;
}

app.whenReady().then(() => {
  const root = path.join(__dirname, 'app');
  protocol.handle('app', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    return net.fetch(url.pathToFileURL(file).toString()).then(r => file.endsWith('.html')
      ? new Response(r.body, { status: r.status, headers: { 'content-type': 'text/html; charset=utf-8' } }) : r);
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
