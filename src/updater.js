// 起動時の更新チェックと適用。
//
// - インストーラー版（NSIS）: electron-updater が GitHub Releases の latest.yml を見て、
//   新しい版があれば裏でダウンロードする。終わったら「いま再起動して適用するか」を聞き、
//   「後で」なら次にアプリを閉じたときに適用する
// - Portable 版: 自分を書き換えられないので、GitHub の API で最新の版を調べて、
//   新しければダウンロードページへの案内だけ出す
// - 開発中（npm start）は何もしない。検査のときは CW_UPDATE_TEST=portable で Portable の
//   道筋だけを通し、ダイアログの代わりに CW_UPDATE_REPORT のファイルに結果を書く
'use strict';

const { app, dialog, shell, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { isNewer } = require('./version');

const OWNER = 'hidetako';
const REPO = 'CWtraining-desktop';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`;
const LATEST_API = process.env.CW_UPDATE_API || `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

const TEST_MODE = process.env.CW_UPDATE_TEST || '';
const REPORT_FILE = process.env.CW_UPDATE_REPORT || '';

/** 自動更新の記録。userData/update.log に残す（困ったときに見る用） */
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack || p.message : String(p))).join(' ')}\n`;
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), line); } catch { /* 書けなくても進む */ }
}

/** 検査のときはダイアログの代わりに結果をファイルへ */
function report(kind, extra = {}) {
  log('report', kind, JSON.stringify(extra));
  if (REPORT_FILE) {
    try { fs.appendFileSync(REPORT_FILE, JSON.stringify({ kind, ...extra }) + '\n'); } catch { /* 無視 */ }
    return true;
  }
  return false;
}

/** Portable 版か（electron-builder の portable は起動時にこの環境変数を立てる） */
function isPortable() {
  if (TEST_MODE === 'portable') return true;
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

/** 設定（起動時に確かめるか）。userData/settings.json */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return { checkOnStartup: true, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch { return { checkOnStartup: true }; }
}
function saveSettings(s) {
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2)); } catch (e) { log('settings save failed', e); }
}

// ── Portable 版: 知らせるだけ ──
async function fetchLatestVersion() {
  const res = await net.fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CWtraining-desktop/${app.getVersion()}` } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  return { version: String(data.tag_name || '').replace(/^v/, ''), url: data.html_url || RELEASES_URL };
}

async function checkPortable({ manual }) {
  const current = app.getVersion();
  let latest;
  try {
    latest = await fetchLatestVersion();
  } catch (e) {
    log('portable check failed', e);
    if (report('error', { message: e.message })) return;
    if (manual) {
      await dialog.showMessageBox({ type: 'warning', title: '更新の確認', message: '更新の確認に失敗しました。', detail: 'ネットに接続していないか、GitHub に届きません。しばらくしてからもう一度試してください。' });
    }
    return;
  }
  if (!isNewer(latest.version, current)) {
    log('portable up to date', current, latest.version);
    if (report('up-to-date', { current, latest: latest.version })) return;
    if (manual) await dialog.showMessageBox({ type: 'info', title: '更新の確認', message: `お使いの版（${current}）が最新です。` });
    return;
  }
  log('portable newer available', current, '->', latest.version);
  if (report('available', { current, latest: latest.version, url: latest.url })) return;
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '新しい版があります',
    message: `新しい版 ${latest.version} があります（お使いの版は ${current}）。`,
    detail: 'Portable 版は自分を書き換えられないので、ダウンロードページから新しい exe を取って入れ替えてください。設定と記録はそのまま引き継がれます。',
    buttons: ['ダウンロードページを開く', '後で'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) shell.openExternal(latest.url);
}

// ── インストーラー版: electron-updater ──
let updater = null;
let downloaded = null;      // ダウンロード済みの版の情報
let manualCheck = false;

function getUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = { info: (...a) => log('[updater]', ...a), warn: (...a) => log('[updater] warn', ...a), error: (...a) => log('[updater] error', ...a), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;     // 「後で」を選んでも、閉じるときに適用する
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('update-available', (info) => log('update available', info.version));
  autoUpdater.on('update-not-available', async (info) => {
    log('up to date', app.getVersion(), 'latest', info?.version);
    if (manualCheck) {
      manualCheck = false;
      await dialog.showMessageBox({ type: 'info', title: '更新の確認', message: `お使いの版（${app.getVersion()}）が最新です。` });
    }
  });
  autoUpdater.on('error', async (err) => {
    log('updater error', err);
    if (manualCheck) {
      manualCheck = false;
      await dialog.showMessageBox({ type: 'warning', title: '更新の確認', message: '更新の確認に失敗しました。', detail: 'ネットに接続していないか、GitHub に届きません。しばらくしてからもう一度試してください。' });
    }
  });
  autoUpdater.on('update-downloaded', async (info) => {
    downloaded = info;
    manualCheck = false;
    log('update downloaded', info.version);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新の準備ができました',
      message: `新しい版 ${info.version} をダウンロードしました。`,
      detail: 'いま再起動して適用しますか？「後で」を選ぶと、次にアプリを閉じたときに適用されます。',
      buttons: ['今すぐ再起動', '後で'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });
  updater = autoUpdater;
  return updater;
}

async function checkInstalled({ manual }) {
  if (downloaded) {
    // 既にダウンロード済みなら、もう一度聞く
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新の準備ができています',
      message: `新しい版 ${downloaded.version} は適用待ちです。`,
      detail: 'いま再起動して適用しますか？',
      buttons: ['今すぐ再起動', '後で'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) setImmediate(() => getUpdater().quitAndInstall());
    return;
  }
  manualCheck = !!manual;
  try {
    await getUpdater().checkForUpdates();
  } catch (e) {
    log('checkForUpdates threw', e);
    if (manual) {
      manualCheck = false;
      await dialog.showMessageBox({ type: 'warning', title: '更新の確認', message: '更新の確認に失敗しました。', detail: String(e.message || e) });
    }
  }
}

/** 更新を確かめる。manual = メニューから押したとき（最新でもそう伝える） */
async function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged && !TEST_MODE) {
    log('skip (not packaged)');
    if (manual) await dialog.showMessageBox({ type: 'info', title: '更新の確認', message: '開発中の起動では更新は確認しません。' });
    return;
  }
  if (isPortable()) return checkPortable({ manual });
  return checkInstalled({ manual });
}

/** 起動時の確認。窓が出てから少し待って、起動を遅くしない */
function scheduleStartupCheck() {
  const s = loadSettings();
  if (!s.checkOnStartup) { log('startup check disabled'); return; }
  setTimeout(() => { checkForUpdates({ manual: false }).catch((e) => log('startup check failed', e)); }, TEST_MODE ? 300 : 4000);
}

module.exports = { checkForUpdates, scheduleStartupCheck, loadSettings, saveSettings, isPortable, RELEASES_URL };
