// 検証環境のアプリ構成を JSON に書き出す（テストの fixture 作成・CLI 版の試作）
// 実行: npm run dump -- [スペースID...]   例: npm run dump -- 15 > test/fixtures/demo-schema.json
// 図から外すアプリ（ビューア自身など）は EXCLUDE_APPS=219 のようにカンマ区切りで渡す
import { collectSchema } from '../src/core/collect';
import type { ApiFn } from '../src/core/types';

const { KINTONE_BASE_URL, KINTONE_USERNAME, KINTONE_PASSWORD } = process.env;
const auth = Buffer.from(`${KINTONE_USERNAME}:${KINTONE_PASSWORD}`).toString('base64');

const api: ApiFn = async (path, _method, params) => {
  const url = new URL(`${path}.json`, KINTONE_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'X-Cybozu-Authorization': auth } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? res.statusText);
  return json;
};

const spaces = process.argv.slice(2);
const exclude = (process.env.EXCLUDE_APPS ?? '').split(',').filter(Boolean);
const schema = await collectSchema(api, { onlySpaceIds: spaces.length ? spaces : undefined, excludeAppIds: exclude });
process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
