// デモ用の架空の部品メーカー（自動車部品・社員30人規模）の業務アプリ群を作るシード。
// 受注 → 生産指示 → 工程実績 → 出荷 → 請求 の流れと、それを支えるマスタ。
//
// アプリ間の関係を3種類すべて含める:
//   ルックアップ（テーブル内のルックアップを含む）／関連レコード一覧／アプリアクション
//
// 実行: node --env-file=.env demo/seed.mjs
// アプリ作成APIはAPIトークン不可のため、パスワード認証（.env）で動かす。

import { api, deploy, SPACE_ID, KINTONE_USERNAME } from './kintone.mjs';

// --- フィールド定義のヘルパー ---
const key = (code) => ({ type: 'SINGLE_LINE_TEXT', code, label: code, required: true, unique: true });
const text = (code, label = code) => ({ type: 'SINGLE_LINE_TEXT', code, label });
const num = (code, unit, label = code) => ({ type: 'NUMBER', code, label, ...(unit ? { unit, unitPosition: 'AFTER' } : {}) });
const date = (code, label = code) => ({ type: 'DATE', code, label, defaultNowValue: true });
const user = (code) => ({ type: 'USER_SELECT', code, label: code });
const drop = (code, opts) => ({
  type: 'DROP_DOWN', code, label: code,
  options: Object.fromEntries(opts.map((o, i) => [o, { label: o, index: String(i) }])),
});
const calc = (code, expression, unit, label = code) => ({
  type: 'CALC', code, label, expression, ...(unit ? { unit, unitPosition: 'AFTER' } : {}),
});
const lookup = (code, app, keyField, mappings, label = code) => ({
  type: 'SINGLE_LINE_TEXT', code, label,
  lookup: {
    relatedApp: { app: String(app) },
    relatedKeyField: keyField,
    fieldMappings: mappings.map(([field, relatedField]) => ({ field, relatedField })),
    lookupPickerFields: [keyField],
    filterCond: '', sort: '',
  },
});
const related = (code, app, field, relatedField, displayFields) => ({
  type: 'REFERENCE_TABLE', code, label: code,
  referenceTable: {
    relatedApp: { app: String(app) },
    condition: { field, relatedField },
    filterCond: '', displayFields, sort: '', size: '5',
  },
});

// API で作ったアプリは、作成者・更新日時などが英語名・英語コードで登録される。
// 画面から作ったアプリと同じ日本語に揃える
const SYSTEM_FIELD_NAME = {
  RECORD_NUMBER: 'レコード番号', CREATOR: '作成者', CREATED_TIME: '作成日時', MODIFIER: '更新者', UPDATED_TIME: '更新日時',
};
export async function localizeSystemFields(app) {
  const { properties } = await api('/preview/app/form/fields', 'GET', { app });
  const changes = Object.fromEntries(Object.values(properties)
    .filter((f) => SYSTEM_FIELD_NAME[f.type] && f.code !== SYSTEM_FIELD_NAME[f.type])
    .map((f) => [f.code, { type: f.type, code: SYSTEM_FIELD_NAME[f.type], label: SYSTEM_FIELD_NAME[f.type] }]));
  if (Object.keys(changes).length) await api('/preview/app/form/fields', 'PUT', { app, properties: changes });
}

// --- アプリ操作 ---
async function addFields(app, list) {
  if (!list.length) return;
  await api('/preview/app/form/fields', 'POST', {
    app, properties: Object.fromEntries(list.map((f) => [f.code, f])),
  });
}

// plain を先に追加し、他フィールドを参照するもの（ルックアップ等）は後から追加する
async function createApp(name, thread, plain, refs = []) {
  const { app } = await api('/preview/app', 'POST', { name, space: SPACE_ID, thread });
  await addFields(app, plain);
  await addFields(app, refs);
  await localizeSystemFields(app);
  await deploy(app);
  console.log(`  ${name}: app ${app}`);
  return Number(app);
}

async function main() {
  const space = await api('/space', 'GET', { id: SPACE_ID });
  const existing = await api('/apps', 'GET', { spaceIds: [SPACE_ID] });
  if (existing.apps.length) {
    console.error(`スペース ${SPACE_ID} に既にアプリがあります（${existing.apps.map((a) => a.name).join(', ')}）。二重作成を避けるため中止します`);
    process.exit(1);
  }
  const thread = space.defaultThread;
  const ids = {};
  console.log(`スペース「${space.name}」にアプリを作成します`);

  // マスタ
  ids.customer = await createApp('取引先マスタ', thread, [
    key('取引先コード'), text('取引先名'), drop('取引区分', ['完成車メーカー', 'Tier1', '商社', 'その他']),
    text('所在地'), text('締め日'),
  ]);
  ids.itemType = await createApp('品目区分マスタ', thread, [
    key('区分コード'), text('区分名'),
  ]);
  ids.item = await createApp('品番マスタ', thread, [
    key('品番'), text('品名'), text('図番'), text('区分名'), text('主要取引先名'),
    num('標準単価', '円'), num('標準リードタイム', '日'),
  ], [
    lookup('区分コード', ids.itemType, '区分コード', [['区分名', '区分名']]),
    lookup('主要取引先コード', ids.customer, '取引先コード', [['主要取引先名', '取引先名']]),
  ]);
  ids.equipment = await createApp('設備マスタ', thread, [
    key('設備コード'), text('設備名'), drop('ライン', ['プレス', '溶接', '切削', '検査']),
  ]);

  // 業務の流れ
  ids.order = await createApp('受注', thread, [
    key('受注番号'), text('取引先名'), date('受注日'), date('納期'),
    drop('受注状況', ['受注', '生産中', '出荷済', '請求済']),
    {
      type: 'SUBTABLE', code: '受注明細', label: '受注明細',
      fields: {
        明細_品名: text('明細_品名', '品名'),
        明細_単価: num('明細_単価', '円', '単価'),
        明細_数量: num('明細_数量', '個', '数量'),
        明細_金額: calc('明細_金額', '明細_単価*明細_数量', '円', '金額'),
        明細_品番: lookup('明細_品番', ids.item, '品番', [['明細_品名', '品名'], ['明細_単価', '標準単価']], '品番'),
      },
    },
    calc('受注金額', 'SUM(明細_金額)', '円'),
  ], [
    lookup('取引先コード', ids.customer, '取引先コード', [['取引先名', '取引先名']]),
  ]);
  ids.workOrder = await createApp('生産指示', thread, [
    key('指示番号'), text('取引先名'), date('納期'), text('品名'), num('指示数量', '個'),
    date('着手予定日'), drop('進捗', ['未着手', '加工中', '検査待ち', '完了']),
  ], [
    lookup('受注番号', ids.order, '受注番号', [['取引先名', '取引先名'], ['納期', '納期']]),
    lookup('品番', ids.item, '品番', [['品名', '品名']]),
  ]);
  ids.result = await createApp('工程実績', thread, [
    key('実績番号'), text('品番'), text('設備名'), date('作業日'),
    drop('工程', ['プレス', '溶接', '切削', '検査']), num('良品数', '個'), num('不良数', '個'),
    user('作業担当'),
  ], [
    lookup('指示番号', ids.workOrder, '指示番号', [['品番', '品番']]),
    lookup('設備コード', ids.equipment, '設備コード', [['設備名', '設備名']]),
  ]);
  ids.shipment = await createApp('出荷', thread, [
    key('出荷番号'), text('取引先コード'), text('取引先名'), date('出荷日'), num('出荷金額', '円'),
  ], [
    lookup('受注番号', ids.order, '受注番号',
      [['取引先コード', '取引先コード'], ['取引先名', '取引先名'], ['出荷金額', '受注金額']]),
  ]);
  ids.invoice = await createApp('請求', thread, [
    key('請求番号'), text('取引先名'), date('請求日'), num('請求金額', '円'),
    drop('入金状況', ['未入金', '入金済']),
  ], [
    lookup('取引先コード', ids.customer, '取引先コード', [['取引先名', '取引先名']]),
  ]);

  // 2周目: 逆向きの関係（関連レコード一覧）
  await addFields(ids.customer, [
    related('受注一覧', ids.order, '取引先コード', '取引先コード', ['受注番号', '受注日', '納期', '受注金額']),
    related('請求一覧', ids.invoice, '取引先コード', '取引先コード', ['請求番号', '請求日', '請求金額', '入金状況']),
  ]);
  await deploy(ids.customer);
  await addFields(ids.order, [
    related('生産指示一覧', ids.workOrder, '受注番号', '受注番号', ['指示番号', '品名', '指示数量', '進捗']),
    related('出荷一覧', ids.shipment, '受注番号', '受注番号', ['出荷番号', '出荷日', '出荷金額']),
  ]);
  await deploy(ids.order);
  await addFields(ids.workOrder, [
    related('工程実績一覧', ids.result, '指示番号', '指示番号', ['実績番号', '工程', '良品数', '不良数']),
  ]);
  await deploy(ids.workOrder);
  await addFields(ids.invoice, [
    related('対象出荷', ids.shipment, '取引先コード', '取引先コード', ['出荷番号', '出荷日', '出荷金額']),
  ]);
  await deploy(ids.invoice);

  // アプリアクション: 受注 → 生産指示／出荷
  await api('/preview/app/actions', 'PUT', {
    app: ids.order,
    actions: {
      生産指示を作成: {
        name: '生産指示を作成', index: '0',
        destApp: { app: String(ids.workOrder) },
        mappings: [
          { srcType: 'FIELD', srcField: '受注番号', destField: '受注番号' },
          { srcType: 'FIELD', srcField: '取引先名', destField: '取引先名' },
          { srcType: 'FIELD', srcField: '納期', destField: '納期' },
        ],
        entities: [{ type: 'USER', code: KINTONE_USERNAME }],
        filterCond: '',
      },
      出荷を登録: {
        name: '出荷を登録', index: '1',
        destApp: { app: String(ids.shipment) },
        mappings: [
          { srcType: 'FIELD', srcField: '受注番号', destField: '受注番号' },
          { srcType: 'FIELD', srcField: '受注金額', destField: '出荷金額' },
        ],
        entities: [{ type: 'USER', code: KINTONE_USERNAME }],
        filterCond: '',
      },
    },
  });
  await deploy(ids.order);

  console.log('完了', ids);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
