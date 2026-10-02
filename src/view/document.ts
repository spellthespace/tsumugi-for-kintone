import { FIELD_TYPE_LABEL } from '../core/collect';
import type { AppInfo, Schema } from '../core/types';
import { esc } from './html';
import { EDGE_STYLE, legend } from './svg';

// 印刷用（PDF）の1冊: 表紙を兼ねたER図 → アプリ一覧 → 関係一覧 → アプリごとの定義書

export interface DocumentInput {
  schema: Schema;
  /** 図に出したアプリ（絞り込み後） */
  apps: AppInfo[];
  scopeLabel: string;
  svg: string;
}

const STYLE = `
@page { size: A4 landscape; margin: 12mm; }
@page diagram { size: A3 landscape; margin: 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif; color: #0f172a; font-size: 10pt; }
.diagram { page: diagram; height: 100vh; display: flex; flex-direction: column; }
.diagram svg { flex: 1; min-height: 0; width: 100%; }
h1 { font-size: 18pt; margin: 0 0 2mm; }
h2 { font-size: 14pt; margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 2px solid #1e40af; }
.meta { color: #475569; font-size: 9pt; margin-bottom: 3mm; display: flex; gap: 6mm; flex-wrap: wrap; align-items: center; }
.ked-legend-item { display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; }
section { break-before: page; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #cbd5e1; padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; white-space: nowrap; }
tr { break-inside: avoid; }
thead { display: table-header-group; }
td.sub { padding-left: 6mm; color: #334155; }
td.c { text-align: center; }
.code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8.5pt; color: #475569; }
.app-meta { color: #475569; margin-bottom: 3mm; }
.warn { color: #b45309; }
@media screen { body { padding: 16px; background: #e2e8f0; } section, .diagram { background: #fff; padding: 16px; margin-bottom: 16px; } .diagram { height: 90vh; } }
`;

const date = (iso: string) => new Date(iso).toLocaleString('ja-JP', { dateStyle: 'long', timeStyle: 'short' });

function appTable(schema: Schema, apps: AppInfo[]) {
  const rows = apps.map((a) => {
    const out = schema.relations.filter((r) => r.fromApp === a.id).length;
    const inc = schema.relations.filter((r) => r.toApp === a.id).length;
    return `<tr><td>${esc(a.name)}</td><td class="c">${esc(a.id)}</td><td>${esc(a.spaceName ?? '—')}</td>` +
      `<td class="c">${a.fields.length}</td><td class="c">${out}</td><td class="c">${inc}</td></tr>`;
  }).join('');
  return `<section><h2>アプリ一覧（${apps.length}件）</h2><table><thead><tr><th>アプリ名</th><th>ID</th><th>スペース</th>` +
    `<th>フィールド数</th><th>参照している</th><th>参照されている</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function relationTable(schema: Schema, apps: AppInfo[]) {
  const ids = new Set(apps.map((a) => a.id));
  const name = (id: string) => schema.apps.find((a) => a.id === id)?.name ?? id;
  const rels = schema.relations.filter((r) => ids.has(r.fromApp) && ids.has(r.toApp));
  const rows = rels.map((r) => `<tr><td>${esc(EDGE_STYLE[r.kind].name)}</td><td>${esc(name(r.fromApp))}</td>` +
    `<td>${esc(r.label)}</td><td>${esc(name(r.toApp))}</td><td>${esc(r.toField ?? '—')}</td></tr>`).join('');
  return `<section><h2>アプリ間の関係（${rels.length}件）</h2><table><thead><tr><th>種類</th><th>設定しているアプリ</th>` +
    `<th>フィールド／アクション</th><th>参照先アプリ</th><th>参照先のキー</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function appDefinition(app: AppInfo) {
  const rows = app.fields.map((f, i) => `<tr><td class="c">${i + 1}</td>` +
    `<td class="${f.subtable ? 'sub' : ''}">${f.subtable ? '└ ' : ''}${esc(f.label)}</td>` +
    `<td class="code">${esc(f.code)}</td><td>${esc(FIELD_TYPE_LABEL[f.type] ?? f.type)}</td>` +
    `<td class="c">${f.required ? '○' : ''}</td><td class="c">${f.unique ? '○' : ''}</td><td>${esc(f.note)}</td></tr>`).join('');
  return `<section><h2>${esc(app.name)}</h2>` +
    `<div class="app-meta">アプリID: ${esc(app.id)}　スペース: ${esc(app.spaceName ?? '—')}` +
    `${app.description ? `<br>${esc(app.description.replace(/<[^>]*>/g, ''))}` : ''}</div>` +
    `<table><thead><tr><th>#</th><th>フィールド名</th><th>フィールドコード</th><th>種類</th><th>必須</th><th>重複禁止</th>` +
    `<th>備考</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export function renderDocument(input: DocumentInput) {
  const { schema, apps, scopeLabel, svg } = input;
  const warnings = schema.warnings.length
    ? `<span class="warn">取得できなかった情報: ${schema.warnings.length}件（アプリ一覧の後に記載）</span>` : '';
  const warnSection = schema.warnings.length
    ? `<section><h2>取得できなかった情報</h2><ul>${schema.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>`
    : '';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>kintone アプリ構成図・定義書</title>` +
    `<style>${STYLE}</style></head><body>` +
    `<div class="diagram"><h1>kintone アプリ構成図</h1>` +
    `<div class="meta"><span>対象: ${esc(scopeLabel)}（${apps.length}アプリ）</span><span>取得: ${esc(date(schema.fetchedAt))}</span>` +
    `<span>${legend()}</span>${warnings}</div>${svg}</div>` +
    appTable(schema, apps) + warnSection + relationTable(schema, apps) + apps.map(appDefinition).join('') +
    `</body></html>`;
}
