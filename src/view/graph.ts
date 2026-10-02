import type { AppInfo, FieldInfo, Relation, Schema } from '../core/types';

// 図に出す内容を決める（どのアプリ・どの行・どの線）。描画方法には依存しない。

/** スペースの絞り込み。'all' = 全アプリ、'none' = スペースに属さないアプリ、それ以外はスペースID */
export type SpaceFilter = 'all' | 'none' | string;

export interface GraphOptions {
  space: SpaceFilter;
  /** true なら全フィールドを出す。false なら関係・キーに関わる行だけ */
  allFields: boolean;
  /** 関係を1本も持たないアプリを隠す */
  hideIsolated: boolean;
}

export interface Row {
  field: FieldInfo;
  /** このアプリの中での行番号（ポートの位置に使う） */
  index: number;
}

export interface GraphNode {
  app: AppInfo;
  rows: Row[];
  /** 図の上では省略した行の数 */
  hidden: number;
}

export interface GraphEdge {
  id: string;
  relation: Relation;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// 図で常に省くフィールド（どのアプリにもあり、関係を持たない）
const NOISE_TYPES = new Set(['RECORD_NUMBER', 'CREATOR', 'CREATED_TIME', 'MODIFIER', 'UPDATED_TIME']);

function inSpace(app: AppInfo, space: SpaceFilter) {
  if (space === 'all') return true;
  if (space === 'none') return app.spaceId === null;
  return app.spaceId === space;
}

export function buildGraph(schema: Schema, opts: GraphOptions): Graph {
  let apps = schema.apps.filter((a) => inSpace(a, opts.space));
  const ids = new Set(apps.map((a) => a.id));
  const relations = schema.relations.filter((r) => ids.has(r.fromApp) && ids.has(r.toApp));

  if (opts.hideIsolated) {
    const linked = new Set(relations.flatMap((r) => [r.fromApp, r.toApp]));
    apps = apps.filter((a) => linked.has(a.id));
  }

  // 関係の端になっているフィールドは、要約表示でも必ず出す
  const ends = new Set<string>();
  for (const r of relations) {
    if (r.fromField) ends.add(`${r.fromApp}:${r.fromField}`);
    if (r.toField) ends.add(`${r.toApp}:${r.toField}`);
  }

  const nodes = apps.map((app): GraphNode => {
    const candidates = app.fields.filter((f) => !NOISE_TYPES.has(f.type));
    const keep = opts.allFields
      ? candidates
      : candidates.filter((f) => f.unique || ends.has(`${app.id}:${f.code}`));
    // テーブル内の行を出すときは、親のテーブル行も出す（どのテーブルの中かが分かるように）
    const parents = new Set(keep.filter((f) => f.subtable).map((f) => f.subtable));
    const shown = candidates.filter((f) => keep.includes(f) || parents.has(f.code));
    return {
      app,
      rows: shown.map((field, index) => ({ field, index })),
      hidden: candidates.length - shown.length,
    };
  });

  const edges = relations.map((relation, i) => ({ id: `e${i}`, relation }));
  return { nodes, edges };
}

/** 絞り込みの選択肢（スペース名つき） */
export function spaceChoices(schema: Schema): { value: SpaceFilter; label: string; count: number }[] {
  const bySpace = new Map<string, { label: string; count: number }>();
  let none = 0;
  for (const a of schema.apps) {
    if (!a.spaceId) { none++; continue; }
    const s = bySpace.get(a.spaceId) ?? { label: a.spaceName ?? `スペース${a.spaceId}`, count: 0 };
    s.count++;
    bySpace.set(a.spaceId, s);
  }
  return [
    { value: 'all', label: 'すべてのアプリ', count: schema.apps.length },
    ...[...bySpace].map(([value, s]) => ({ value, ...s })).sort((a, b) => a.label.localeCompare(b.label, 'ja')),
    ...(none ? [{ value: 'none' as const, label: 'スペースに属さないアプリ', count: none }] : []),
  ];
}
