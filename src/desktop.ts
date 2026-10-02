import type { ApiFn } from './core/types';
import { mountViewer } from './view/viewer';

// カスタムビューに <div id="tsumugi"></div> を置いた一覧で、図を表示する。

declare const kintone: any;

const ROOT_ID = 'tsumugi';

const api: ApiFn = (path, method, params) => kintone.api(kintone.api.url(path, true), method, params);

async function start(root: HTMLElement) {
  const selfAppId = String(kintone.app.getId());
  let defaultSpace = 'all';
  try {
    const self = await api('/k/v1/app', 'GET', { id: selfAppId });
    if (self.spaceId) defaultSpace = String(self.spaceId);
  } catch { /* 既定は全アプリ */ }
  await mountViewer(root, { api, selfAppId, defaultSpace });
}

// 一覧の表示を止めないよう、イベントは同期で返して描画は裏で進める
kintone.events.on('app.record.index.show', (event: any) => {
  const root = document.getElementById(ROOT_ID);
  if (root && !root.dataset.mounted) {
    root.dataset.mounted = '1';
    start(root).catch((e) => console.error('[tsumugi]', e));
  }
  return event;
});
