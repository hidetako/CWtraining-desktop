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

rmSync(userData, { recursive: true, force: true });
console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
process.exit(fails.length ? 1 : 0);
