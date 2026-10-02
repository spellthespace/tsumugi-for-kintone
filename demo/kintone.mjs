// デモ用スクリプトの共通部品（パスワード認証で kintone REST API を呼ぶ）

export const { KINTONE_BASE_URL, KINTONE_USERNAME, KINTONE_PASSWORD, DEMO_SPACE_ID } = process.env;
if (!KINTONE_BASE_URL || !KINTONE_USERNAME || !KINTONE_PASSWORD || !DEMO_SPACE_ID) {
  console.error('.env の KINTONE_BASE_URL / KINTONE_USERNAME / KINTONE_PASSWORD / DEMO_SPACE_ID を設定してください');
  process.exit(1);
}
export const SPACE_ID = Number(DEMO_SPACE_ID);
const AUTH = Buffer.from(`${KINTONE_USERNAME}:${KINTONE_PASSWORD}`).toString('base64');

export async function api(path, method, body) {
  const isGet = method === 'GET';
  const url = new URL(`/k/v1${path}.json`, KINTONE_BASE_URL);
  if (isGet && body) {
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach((x, i) => url.searchParams.append(`${k}[${i}]`, x));
      else url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method,
    headers: { 'X-Cybozu-Authorization': AUTH, ...(isGet ? {} : { 'Content-Type': 'application/json' }) },
    body: isGet ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function deploy(app) {
  await api('/preview/app/deploy', 'POST', { apps: [{ app }] });
  for (let i = 0; i < 60; i++) {
    const { apps } = await api('/preview/app/deploy', 'GET', { apps: [app] });
    if (apps[0].status === 'SUCCESS') return;
    if (apps[0].status === 'FAIL') throw new Error(`deploy failed: app ${app}`);
    await sleep(1000);
  }
  throw new Error(`deploy timeout: app ${app}`);
}

