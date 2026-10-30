// Web 版（hidetako/CWtraining）の画面ファイルを app/ に取り込む。
//
//   node scripts/fetch-app.mjs            … GitHub の main を浅く clone して取り込む
//   APP_REF=v1.2 node scripts/fetch-app.mjs … 枝・タグ・commit を指定
//   APP_SRC=../CWtraining node scripts/fetch-app.mjs … 手元の作業ディレクトリから取り込む
//
// 取り込むのは画面を動かすファイルだけ（検査や説明書の元は入れない）。
// 取り込んだ元の commit と日付を app/VERSION.json に残し、アプリの「このアプリについて」に出す
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'app');
const REPO = process.env.APP_REPO ?? 'https://github.com/hidetako/CWtraining.git';
const REF = process.env.APP_REF ?? 'main';

// 画面に要るものだけ。cheatsheet.html はアプリ内の「カンニングペーパー」リンク先
const INCLUDE = ['index.html', 'cheatsheet.html', 'css', 'js', 'fonts', 'favicon.svg', 'icon.svg', 'icon-512.png', 'apple-touch-icon.png'];

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

let src = process.env.APP_SRC ? path.resolve(process.env.APP_SRC) : null;
let tmp = null;
if (!src) {
  tmp = mkdtempSync(path.join(tmpdir(), 'cwtraining-app-'));
  console.log(`取得: ${REPO} (${REF})`);
  git(['clone', '--quiet', '--depth', '1', '--branch', REF, REPO, tmp]);
  src = tmp;
}
if (!existsSync(path.join(src, 'index.html'))) {
  console.error(`index.html が見つかりません: ${src}`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const name of INCLUDE) {
  const from = path.join(src, name);
  if (!existsSync(from)) { console.warn(`（無し: ${name}）`); continue; }
  cpSync(from, path.join(DEST, name), { recursive: true });
}

let commit = '';
let date = '';
try {
  commit = git(['rev-parse', 'HEAD'], src);
  date = git(['log', '-1', '--format=%cs'], src);
} catch { /* git 管理外のフォルダーから取り込んだときは空のまま */ }
writeFileSync(path.join(DEST, 'VERSION.json'), JSON.stringify({ repo: REPO, ref: REF, commit, date, fetchedAt: new Date().toISOString() }, null, 2) + '\n');

if (tmp) rmSync(tmp, { recursive: true, force: true });
console.log(`app/ に取り込みました（${commit ? commit.slice(0, 7) : 'commit 不明'} ${date}）`);
