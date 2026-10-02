// dist/plugin.zip を kintone に読み込む（初回は追加、2回目以降は更新）
// kintone のプラグイン API（/k/v1/plugin.json）を使う。システム管理者のパスワード認証が必要。
import { readFileSync } from 'node:fs';

const { KINTONE_BASE_URL, KINTONE_USERNAME, KINTONE_PASSWORD } = process.env;
const PLUGIN_ID = process.argv[2];
const auth = { 'X-Cybozu-Authorization': Buffer.from(`${KINTONE_USERNAME}:${KINTONE_PASSWORD}`).toString('base64') };

async function call(path, method, body) {
  const res = await fetch(new URL(`/k/v1/${path}.json`, KINTONE_BASE_URL), {
    method, headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

const form = new FormData();
form.append('file', new Blob([readFileSync('dist/plugin.zip')], { type: 'application/zip' }), 'plugin.zip');
const up = await fetch(new URL('/k/v1/file.json', KINTONE_BASE_URL), { method: 'POST', headers: auth, body: form });
const { fileKey } = await up.json();
if (!fileKey) throw new Error('ファイルのアップロードに失敗しました');

// GET は body を付けられないので、call を使わずに取る
const list = await fetch(new URL('/k/v1/plugins.json?limit=100', KINTONE_BASE_URL), { headers: auth });
const { plugins } = await list.json();
const installed = PLUGIN_ID && plugins?.some((p) => p.id === PLUGIN_ID);
const res = installed
  ? await call('plugin', 'PUT', { id: PLUGIN_ID, fileKey })
  : await call('plugin', 'POST', { fileKey });
console.log(installed ? '更新しました' : '追加しました', res);
