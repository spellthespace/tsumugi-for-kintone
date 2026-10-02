// 図を表示する「アプリ構成図」アプリを作り、プラグインとカスタムビューを設定する。
// 先に npm run upload でプラグインを読み込んでおくこと。
// 実行: node --env-file=.env demo/setup-viewer.mjs <プラグインID> [既存のアプリID]
// 途中で失敗した場合は、作りかけのアプリIDを2つ目に渡すと続きから設定する。
import { api, deploy, SPACE_ID } from './kintone.mjs';

const PLUGIN_ID = process.argv[2];
if (!PLUGIN_ID) {
  console.error('プラグインIDを指定してください');
  process.exit(1);
}

let app = process.argv[3];
if (!app) {
  const space = await api('/space', 'GET', { id: SPACE_ID });
  ({ app } = await api('/preview/app', 'POST', {
    name: 'アプリ構成図', space: SPACE_ID, thread: space.defaultThread,
  }));
  console.log(`アプリ ${app} を作成しました`);
}
const { plugins } = await api('/preview/app/plugins', 'GET', { app });
if (!plugins.some((p) => p.id === PLUGIN_ID)) await api('/preview/app/plugins', 'POST', { app, ids: [PLUGIN_ID] });
await api('/preview/app/views', 'PUT', {
  app,
  views: {
    アプリ構成図: {
      type: 'CUSTOM', name: 'アプリ構成図', index: '0',
      html: '<div id="tsumugi"></div>', pager: false,
    },
  },
});
await deploy(app);
const { views } = await api('/app/views', 'GET', { app });
const viewId = views['アプリ構成図'].id;
console.log(`作成しました: ${new URL(`/k/${app}/?view=${viewId}`, process.env.KINTONE_BASE_URL)}`);
