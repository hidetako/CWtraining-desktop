// 組み立てたアプリを実際に起動して確かめる（Playwright の Electron 対応を使う）。
//   npm run fetch-app && npm run check
// Linux の CI や手元では xvfb-run の下で動かす。
//
// 見るのは: 画面が app:// で開く / タブが切り替わる / ドリルが出題される /
// 設定が保存されて再起動後も残る / 外のリンクはアプリの外へ渡される
const { _electron: electron } = await import(process.env.PW ?? 'playwright-core');
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS ?? ROOT;
const userData = mkdtempSync(path.join(tmpdir(), 'cwtraining-userdata-'));
const fails = [];
const ok = (label, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + label + (extra ? `  [${extra}]` : '')); if (!cond) fails.push(label); };

// Electron 本体の場所。playwright が別の場所に入っていても見つかるように、こちらで指す
const { createRequire } = await import('node:module');
const electronPath = createRequire(path.join(ROOT, 'package.json'))('electron');

// EXE=dist/linux-unpacked/cwtraining-desktop のように組み立てた物を指せば、その実行ファイルを見る
const packaged = process.env.EXE ? path.resolve(process.env.EXE) : null;

const launch = () => electron.launch({
  executablePath: packaged ?? electronPath,
  args: [...(packaged ? [] : [ROOT]), `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
});

let app = await launch();
let page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

ok('app:// で画面が開く', page.url() === 'app://cw/index.html', page.url());
ok('題名が入る', (await page.title()).includes('CW'), await page.title());
ok('タブが並ぶ', (await page.locator('.tab').count()) >= 8, String(await page.locator('.tab').count()));

await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
await page.click('#btn-drill-new');
await page.waitForFunction(() => document.querySelector('#drill-countdown')?.hidden === true, null, { timeout: 15000 }).catch(() => {});
const problem = await page.evaluate(() => window.__cw?.drillProblem?.answer ?? '');
ok('ドリルが出題される', problem.length > 0, problem);
await page.evaluate(() => window.__cw?.player?.stop());

await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);
const call = await page.inputValue('#set-callsign').catch(() => '');
ok('自局の初期値が入る', /^[A-Z0-9]{4,}$/.test(call), call);

// 設定タブの「Windows 版（デスクトップ）」の欄（preload の橋が本物）
const appVersion = createRequire(path.join(ROOT, 'package.json'))('./package.json').version;
const card = await page.evaluate(() => ({
  hidden: document.querySelector('#desktop-card')?.hidden,
  version: document.querySelector('#desktop-version')?.textContent ?? '',
}));
ok('設定タブに Windows 版の欄が出る', card.hidden === false, JSON.stringify(card));
ok('欄に exe の版と Web 版の commit が出る', card.version.includes(`版 ${appVersion}`) && /Web 版の取り込み: [0-9a-f]{7}/.test(card.version), card.version);
await page.locator('#desktop-card').scrollIntoViewIfNeeded();
await page.click('#btn-desktop-update');
await page.waitForTimeout(600);
ok('開発中の起動では「確認しません」と欄に出る', /開発中/.test(await page.textContent('#desktop-update-status')), await page.textContent('#desktop-update-status'));
await page.fill('#set-callsign', 'JA9TEST');
await page.dispatchEvent('#set-callsign', 'change');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, 'desktop-settings.png') });

// 外のリンクは setWindowOpenHandler で deny され、shell.openExternal に渡る。
// 窓が増えないことで確かめる
const before = (await app.windows()).length;
await page.evaluate(() => window.open('https://example.com/'));
await page.waitForTimeout(600);
ok('外のリンクで窓が増えない', (await app.windows()).length === before, String((await app.windows()).length));

// アプリ内のページ（カンニングペーパー）は新しい窓で開く
const popup = app.waitForEvent('window', { timeout: 8000 }).catch(() => null);
await page.evaluate(() => window.open('app://cw/cheatsheet.html'));
const sheet = await popup;
ok('カンニングペーパーが別窓で開く', !!sheet && sheet.url() === 'app://cw/cheatsheet.html', sheet?.url() ?? 'none');
if (sheet) await sheet.close();

await app.close();

// 再起動して保存が残っているか
app = await launch();
page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(600);
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);
const kept = await page.inputValue('#set-callsign').catch(() => '');
ok('設定が再起動後も残る', kept === 'JA9TEST', kept);
await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, 'desktop-home.png') });
await app.close();

// ── 更新チェック（Portable の道筋を、偽の GitHub API とファイルへの報告で確かめる） ──
const { isNewer } = createRequire(import.meta.url)('../src/version.js');
ok('版の比べ方（1.0.10 > 1.0.9、v 付き・beta 付きも）', isNewer('1.0.10', '1.0.9') && isNewer('v1.1.0', '1.0.5') && !isNewer('1.0.0', '1.0.0') && isNewer('2.0.0-beta.1', '1.9.9'));

const http = await import('node:http');
const { readFileSync, writeFileSync } = await import('node:fs');
let fakeTag = 'v99.0.0';
const api = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ tag_name: fakeTag, html_url: `https://example.com/releases/${fakeTag}` })); });
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const apiUrl = `http://127.0.0.1:${api.address().port}/latest`;

const updateProbe = async (tag) => {
  fakeTag = tag;
  const reportFile = path.join(userData, `update-report-${tag}.txt`);
  writeFileSync(reportFile, '');
  const a = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: [...(packaged ? [] : [ROOT]), `--user-data-dir=${userData}`, '--no-sandbox'],
    env: { ...process.env, CW_UPDATE_TEST: 'portable', CW_UPDATE_API: apiUrl, CW_UPDATE_REPORT: reportFile },
  });
  const w = await a.firstWindow();
  let text = '';
  for (let i = 0; i < 40 && !text.trim(); i++) { await new Promise((r) => setTimeout(r, 250)); text = readFileSync(reportFile, 'utf8'); }
  // 欄のボタンからも確認できる（状態は欄に流れる）
  await w.waitForLoadState('domcontentloaded');
  await w.click('.tab[data-panel="settings"]');
  await w.waitForTimeout(200);
  await w.locator('#desktop-card').scrollIntoViewIfNeeded();
  await w.click('#btn-desktop-update');
  await w.waitForFunction(() => !/確認しています/.test(document.querySelector('#desktop-update-status').textContent), null, { timeout: 5000 }).catch(() => {});
  const inPage = await w.textContent('#desktop-update-status');
  await a.close();
  return { report: text.trim() ? JSON.parse(text.trim().split('\n')[0]) : null, inPage };
};
const newer = await updateProbe('v99.0.0');
ok('新しい版があれば起動時に知らせる（Portable）', newer.report?.kind === 'available' && newer.report.latest === '99.0.0' && /example\.com/.test(newer.report.url), JSON.stringify(newer.report));
ok('欄の「最新版に更新する」でも新しい版の案内が欄に出る', /99\.0\.0/.test(newer.inPage) && /Portable 版/.test(newer.inPage), newer.inPage);
const same = await updateProbe('v0.0.1');
ok('古い版しか無ければ何も出さない', same.report?.kind === 'up-to-date', JSON.stringify(same.report));
ok('欄では「最新です」と出る', /最新です/.test(same.inPage), same.inPage);
api.close();

rmSync(userData, { recursive: true, force: true });
console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
process.exit(fails.length ? 1 : 0);
