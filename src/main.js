// CW 交信トレーニング（スタンドアロン版）の本体。
//
// Web 版（hidetako/CWtraining）の index.html / js / css をそのまま app/ に置き、
// 自前の app:// スキームで配信して 1 枚の窓に出す。file:// で開くと ES モジュールや
// localStorage の扱いがブラウザごとに違うので、標準スキームとして登録した app:// を
// 使う（origin が app://cw に固定され、設定や記録の保存先も安定する）。
'use strict';

const {
  app, BrowserWindow, Menu, dialog, desktopCapturer, net, protocol, session, shell, nativeImage,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_HOST = 'cw';
const APP_ORIGIN = `app://${APP_HOST}`;
const APP_DIR = path.join(__dirname, '..', 'app');
const WEB_URL = 'https://hidetako.github.io/CWtraining/';
const MANUAL_URL = 'https://github.com/hidetako/CWtraining/blob/main/docs/MANUAL.md';
const RELEASES_URL = 'https://github.com/hidetako/CWtraining-desktop/releases';

// Web Audio を最初のクリックより前から鳴らせるようにする（練習音・サイドトーン）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 2 重起動は既に開いている窓を前に出すだけにする（設定の保存が食い違わないように）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

// app:// を https 相当の「標準スキーム」として登録する。app.ready より前に呼ぶ決まり
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

/** app/VERSION.json（取り込んだ Web 版の commit と日付）。無ければ空 */
function appVersionInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(APP_DIR, 'VERSION.json'), 'utf8')); } catch { return {}; }
}

/** app://cw/… を app/ の中のファイルに写す。app/ の外には出さない */
function serveApp() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('not found', { status: 404 });
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(APP_DIR, p));
    if (!file.startsWith(APP_DIR + path.sep)) return new Response('forbidden', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** マイク・画面の音・位置情報は、この app:// の画面からの求めだけ許す */
function allowMedia() {
  const ALLOWED = new Set(['media', 'display-capture', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write']);
  const fromApp = (origin) => typeof origin === 'string' && origin.startsWith(APP_ORIGIN);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(ALLOWED.has(permission) && fromApp(details?.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ALLOWED.has(permission) && fromApp(origin));

  // 「画面の音を拾う」: ブラウザの共有ダイアログの代わりに、主画面をそのまま渡す。
  // Windows では audio: 'loopback' でパソコンで鳴っている音（YouTube など）が取れる。
  // Web 版と同じく、アプリ側は映像をすぐ止めて音だけ使う
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (!sources.length) { callback({}); return; }
      callback({ video: sources[0], audio: process.platform === 'win32' ? 'loopback' : undefined });
    } catch {
      callback({});
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: 'CW 交信トレーニング',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,          // Alt で出る。普段は画面を広く使う
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // 外のサイト（説明書・参考リンク）は既定のブラウザで開く。
  // 同じアプリの中のページ（カンニングペーパー）は新しい窓で開く
  const openOutside = (url) => { if (/^https?:/i.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN + '/')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 900, autoHideMenuBar: true, backgroundColor: '#ffffff' } };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN + '/')) { e.preventDefault(); openOutside(url); }
  });

  win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

function buildMenu() {
  const info = appVersionInfo();
  const about = () => dialog.showMessageBox({
    type: 'info',
    title: 'CW 交信トレーニングについて',
    message: `CW 交信トレーニング ${app.getVersion()}`,
    detail: [
      `Web 版の取り込み: ${info.commit ? info.commit.slice(0, 7) : '不明'}${info.date ? `（${info.date}）` : ''}`,
      `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      '',
      '設定と記録はこのパソコンの中だけに保存されます。',
      `保存先: ${app.getPath('userData')}`,
    ].join('\n'),
    icon: nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')),
  });

  const template = [
    {
      label: '表示',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { type: 'separator' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { role: 'resetZoom', label: '標準の大きさ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面' },
        { role: 'toggleDevTools', label: '開発者ツール' },
      ],
    },
    {
      label: 'ヘルプ',
      submenu: [
        { label: '使い方説明書（ブラウザで開く）', click: () => shell.openExternal(MANUAL_URL) },
        { label: 'Web 版を開く', click: () => shell.openExternal(WEB_URL) },
        { label: '新しい版を確かめる', click: () => shell.openExternal(RELEASES_URL) },
        { type: 'separator' },
        { label: '設定の保存先フォルダーを開く', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        { label: 'このアプリについて', click: about },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  serveApp();
  allowMedia();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
