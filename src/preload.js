// 画面側に「スタンドアロン版で動いている」ことだけを知らせる。
// Web 版のコードはこれを見なくても動く（見ない）。将来、画面側で
// デスクトップ版だけの振る舞いが要るときの目印
'use strict';
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('cwDesktop', {
  platform: process.platform,
  electron: process.versions.electron,
});
