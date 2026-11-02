// 版の番号の比べ方。'v1.2.3' や '1.2.3-beta.1' を数の並びにして比べる（Node だけで動く）
'use strict';

/** '1.2.3' → [1, 2, 3]。先頭の v と、'-' 以降（beta などの印）は落とす */
function parse(v) {
  return String(v ?? '').trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
}

/** a < b なら負、同じなら 0、a > b なら正 */
function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** latest が current より新しいか */
function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
}

module.exports = { parse, compareVersions, isNewer };
