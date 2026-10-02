import type { ApiFn, AppInfo, FieldInfo, Relation, Schema } from './types';

// 種類ごとの日本語名（定義書・図で使う）
export const FIELD_TYPE_LABEL: Record<string, string> = {
  SINGLE_LINE_TEXT: '文字列（1行）', MULTI_LINE_TEXT: '文字列（複数行）', RICH_TEXT: 'リッチエディター',
  NUMBER: '数値', CALC: '計算', RADIO_BUTTON: 'ラジオボタン', CHECK_BOX: 'チェックボックス',
  MULTI_SELECT: '複数選択', DROP_DOWN: 'ドロップダウン', DATE: '日付', TIME: '時刻', DATETIME: '日時',
  FILE: '添付ファイル', LINK: 'リンク', USER_SELECT: 'ユーザー選択', ORGANIZATION_SELECT: '組織選択',
  GROUP_SELECT: 'グループ選択', REFERENCE_TABLE: '関連レコード一覧', SUBTABLE: 'テーブル', GROUP: 'グループ',
  RECORD_NUMBER: 'レコード番号', CREATOR: '作成者', CREATED_TIME: '作成日時', MODIFIER: '更新者',
  UPDATED_TIME: '更新日時', STATUS: 'ステータス', STATUS_ASSIGNEE: '作業者', CATEGORY: 'カテゴリー',
  LOOKUP: 'ルックアップ',
};

// 定義書に載せない（全アプリに必ずあり、設計の情報を持たない）フィールド
const SYSTEM_TYPES = new Set(['STATUS', 'STATUS_ASSIGNEE', 'CATEGORY']);

/** 同時に投げるリクエスト数。利用者の他の操作や連携を圧迫しないよう控えめにする */
const CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const errMessage = (e: unknown) =>
  (e as { message?: string })?.message ?? (typeof e === 'string' ? e : JSON.stringify(e));

async function listApps(api: ApiFn) {
  const apps: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const res = await api('/k/v1/apps', 'GET', { limit: 100, offset });
    apps.push(...res.apps);
    if (res.apps.length < 100) return apps;
  }
}

function describe(f: any, appName: (id: string) => string): string {
  if (f.lookup) {
    const maps = (f.lookup.fieldMappings ?? []).map((m: any) => `${m.relatedField}→${m.field}`);
    return `ルックアップ: ${appName(String(f.lookup.relatedApp.app))} の ${f.lookup.relatedKeyField}` +
      (maps.length ? `（コピー: ${maps.join('、')}）` : '');
  }
  if (f.referenceTable) {
    const rt = f.referenceTable;
    return `関連レコード: ${appName(String(rt.relatedApp.app))}（${rt.condition.field} = ${rt.condition.relatedField}）`;
  }
  if (f.type === 'CALC') return `計算式: ${f.expression}`;
  if (f.options) {
    const opts = Object.values(f.options as Record<string, { label: string; index: string }>)
      .sort((a, b) => Number(a.index) - Number(b.index)).map((o) => o.label);
    return `選択肢: ${opts.join(' / ')}`;
  }
  if (f.type === 'NUMBER' && f.unit) return `単位: ${f.unit}`;
  return '';
}

function toField(f: any, appName: (id: string) => string, subtable?: string): FieldInfo {
  return {
    code: f.code,
    label: f.label ?? f.code,
    type: f.lookup ? 'LOOKUP' : f.type,
    required: !!f.required,
    unique: !!f.unique,
    subtable,
    note: describe(f, appName),
  };
}

/** layout の並び順で、フィールドを1列に並べる（テーブル内のフィールドはテーブルの直後） */
function orderFields(
  properties: Record<string, any>, layout: any[] | null, appName: (id: string) => string,
): FieldInfo[] {
  const seen = new Set<string>();
  const out: FieldInfo[] = [];
  const push = (code: string, subOrder?: string[]) => {
    const f = properties[code];
    if (!f || seen.has(code) || SYSTEM_TYPES.has(f.type)) return;
    seen.add(code);
    if (f.type === 'GROUP') return; // グループは見出しでしかないので行にしない
    out.push(toField(f, appName));
    if (f.type === 'SUBTABLE') {
      const subs = f.fields as Record<string, any>;
      const order = [...new Set([...(subOrder ?? []), ...Object.keys(subs)])].filter((c) => subs[c]);
      for (const c of order) out.push(toField(subs[c], appName, code));
    }
  };
  const walk = (rows: any[]) => {
    for (const row of rows) {
      if (row.type === 'SUBTABLE') push(row.code, (row.fields ?? []).map((f: any) => f.code));
      else if (row.type === 'GROUP') { push(row.code); walk(row.layout ?? []); }
      else for (const f of row.fields ?? []) if (f.code) push(f.code);
    }
  };
  if (layout) walk(layout);
  // レイアウトに出てこないもの（レコード番号など）を末尾に
  for (const code of Object.keys(properties)) push(code);
  return out;
}

/** フィールド定義とアクション定義から、アプリ間の関係を取り出す */
export function extractRelations(
  appId: string, properties: Record<string, any>, actions: Record<string, any> | null,
): Relation[] {
  const rels: Relation[] = [];
  const visit = (f: any, prefix: string) => {
    if (f.lookup) {
      rels.push({
        kind: 'lookup', fromApp: appId, fromField: f.code,
        toApp: String(f.lookup.relatedApp.app), toField: f.lookup.relatedKeyField,
        label: `${prefix}${f.label ?? f.code}`,
      });
    }
    if (f.referenceTable) {
      const rt = f.referenceTable;
      rels.push({
        kind: 'related', fromApp: appId, fromField: f.code,
        toApp: String(rt.relatedApp.app), toField: rt.condition.relatedField,
        label: f.label ?? f.code,
      });
    }
    if (f.type === 'SUBTABLE') {
      for (const sub of Object.values(f.fields as Record<string, any>)) visit(sub, `${f.label ?? f.code}.`);
    }
  };
  for (const f of Object.values(properties)) visit(f, '');
  for (const a of Object.values(actions ?? {})) {
    rels.push({
      kind: 'action', fromApp: appId, fromField: null,
      toApp: String(a.destApp.app), toField: null, label: a.name,
    });
  }
  return rels;
}

export interface CollectOptions {
  /** 図に含めないアプリ（ビューア自身など） */
  excludeAppIds?: string[];
  /** 指定したスペースのアプリだけを取得する（未指定なら全アプリ） */
  onlySpaceIds?: string[];
  onProgress?: (done: number, total: number) => void;
}

/** 見えている全アプリの構成を取得する */
export async function collectSchema(api: ApiFn, opts: CollectOptions = {}): Promise<Schema> {
  const exclude = new Set(opts.excludeAppIds ?? []);
  const warnings: string[] = [];
  const only = opts.onlySpaceIds ? new Set(opts.onlySpaceIds) : null;
  const rawApps = (await listApps(api)).filter((a) =>
    !exclude.has(String(a.appId)) && (!only || only.has(String(a.spaceId))));

  const spaceIds = [...new Set(rawApps.map((a) => a.spaceId).filter(Boolean))] as string[];
  const spaceNames = new Map<string, string>();
  await mapLimit(spaceIds, CONCURRENCY, async (id) => {
    try {
      spaceNames.set(id, (await api('/k/v1/space', 'GET', { id })).name);
    } catch {
      spaceNames.set(id, `スペース${id}`); // 非公開スペースなどは名前が取れない
    }
  });

  const names = new Map(rawApps.map((a) => [String(a.appId), a.name as string]));
  const appName = (id: string) => names.get(id) ?? `アプリ${id}`;

  let done = 0;
  const results = await mapLimit(rawApps, CONCURRENCY, async (a) => {
    const id = String(a.appId);
    let properties: Record<string, any> = {};
    let layout: any[] | null = null;
    let actions: Record<string, any> | null = null;
    try {
      // lang=user: システムフィールド名などを、見ている人の言語で取る
      properties = (await api('/k/v1/app/form/fields', 'GET', { app: id, lang: 'user' })).properties;
    } catch (e) {
      warnings.push(`${a.name}（${id}）: フィールドを取得できませんでした（${errMessage(e)}）`);
    }
    try {
      layout = (await api('/k/v1/app/form/layout', 'GET', { app: id })).layout;
    } catch {
      // 並び順が取れないだけなので、警告にはしない
    }
    try {
      actions = (await api('/k/v1/app/actions', 'GET', { app: id })).actions;
    } catch (e) {
      warnings.push(`${a.name}（${id}）: アクションを取得できませんでした（アプリ管理権限が必要）`);
    }
    opts.onProgress?.(++done, rawApps.length);
    const app: AppInfo = {
      id, name: a.name,
      spaceId: a.spaceId ? String(a.spaceId) : null,
      spaceName: a.spaceId ? spaceNames.get(String(a.spaceId)) ?? null : null,
      description: a.description ?? '',
      fields: orderFields(properties, layout, appName),
    };
    return { app, relations: extractRelations(id, properties, actions) };
  });

  const apps = results.map((r) => r.app);
  const known = new Set(apps.map((a) => a.id));
  const relations: Relation[] = [];
  for (const r of results.flatMap((x) => x.relations)) {
    if (known.has(r.toApp)) relations.push(r);
    else if (!exclude.has(r.toApp)) {
      const from = apps.find((a) => a.id === r.fromApp)?.name;
      warnings.push(`${from}（${r.fromApp}）の「${r.label}」の参照先アプリ${r.toApp}は、閲覧権限がないため図に出せません`);
    }
  }
  return { fetchedAt: new Date().toISOString(), apps, relations, warnings };
}
