// 画面（Web 版のコード）と exe 側（main プロセス）をつなぐ橋。
// 画面側は window.cwDesktop があれば「Windows 版（デスクトップ）」の欄を出し、
// 版の表示・更新の確認・適用をここ経由で頼む。Web 版（ブラウザ）にはこの橋が無い。
//
// 約束（CWtraining の js/app.js initDesktop と合わせてある）:
//   getInfo() → { version, portable, webCommit, webDate, checkOnStartup, updateState, electron }
//   checkForUpdates() … 進み具合は onUpdateStatus で届く
//   installUpdate() / setCheckOnStartup(bool) / openReleases()
//   onUpdateStatus(cb) … cb({ state, version, percent, url, message })
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cwDesktop', {
  platform: process.platform,
  electron: process.versions.electron,
  getInfo: () => ipcRenderer.invoke('cw:desktop-info'),
  checkForUpdates: () => ipcRenderer.invoke('cw:check-updates'),
  installUpdate: () => ipcRenderer.invoke('cw:install-update'),
  setCheckOnStartup: (on) => ipcRenderer.invoke('cw:set-check-on-startup', !!on),
  openReleases: () => ipcRenderer.invoke('cw:open-releases'),
  onUpdateStatus: (cb) => { ipcRenderer.on('cw:update-status', (_e, status) => cb(status)); },
});
