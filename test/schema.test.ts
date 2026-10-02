import { describe, expect, it } from 'vitest';
import { buildGraph, spaceChoices } from '../src/view/graph';
import { components, layout } from '../src/view/layout';
import { renderSvg } from '../src/view/svg';
import { renderDocument } from '../src/view/document';
import type { Schema } from '../src/core/types';
import fixture from './fixtures/demo-schema.json';

// 検証環境の架空の部品メーカー（9アプリ）から取った構成
const schema = fixture as Schema;
const byName = (n: string) => schema.apps.find((a) => a.name === n)!;

describe('関係の取り出し', () => {
  it('ルックアップ・関連レコード一覧・アクションを種類別に数える', () => {
    const count = (k: string) => schema.relations.filter((r) => r.kind === k).length;
    expect([count('lookup'), count('related'), count('action')]).toEqual([10, 6, 2]);
  });

  it('テーブル内のルックアップを、テーブル名つきで拾う', () => {
    const r = schema.relations.find((x) => x.fromField === '明細_品番')!;
    expect(r.fromApp).toBe(byName('受注').id);
    expect(r.toApp).toBe(byName('品番マスタ').id);
    expect(r.label).toBe('受注明細.品番');
  });

  it('定義書の並びはフォームの配置どおりで、テーブル内はテーブル直後', () => {
    const codes = byName('受注').fields.map((f) => f.code);
    const t = codes.indexOf('受注明細');
    expect(codes.slice(t + 1, t + 6)).toEqual(['明細_品名', '明細_単価', '明細_数量', '明細_金額', '明細_品番']);
  });
});

describe('図の組み立て', () => {
  const graph = buildGraph(schema, { space: 'all', allFields: false, hideIsolated: false });

  it('要約表示では、関係の端とキーのフィールドだけ出す', () => {
    const order = graph.nodes.find((n) => n.app.name === '受注')!;
    const shown = order.rows.map((r) => r.field.code);
    expect(shown).toContain('受注番号'); // 重複禁止
    expect(shown).toContain('取引先コード'); // ルックアップ元
    expect(shown).toContain('明細_品番'); // テーブル内のルックアップ
    expect(shown).toContain('受注明細'); // その親テーブル
    expect(shown).not.toContain('受注日');
    expect(order.hidden).toBeGreaterThan(0);
  });

  it('スペースの選択肢に件数が付く', () => {
    expect(spaceChoices(schema)[0]).toMatchObject({ value: 'all', count: 9 });
  });

  it('elk で配置し、すべての線に経路が付く', async () => {
    const placed = await layout(graph);
    expect(placed.nodes).toHaveLength(9);
    expect(placed.edges).toHaveLength(18);
    for (const e of placed.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
    // 箱どうしが重ならない
    for (const a of placed.nodes) for (const b of placed.nodes) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
    const svg = renderSvg(placed);
    expect(svg).toContain('受注');
    const html = renderDocument({ schema, apps: placed.nodes.map((n) => n.app), scopeLabel: 'テスト', svg });
    expect(html).toContain('アプリ間の関係（18件）');
  });

  it('アプリ名などはエスケープする', async () => {
    const evil = structuredClone(schema);
    evil.apps[0].name = '<img src=x onerror=alert(1)>';
    const placed = await layout(buildGraph(evil, { space: 'all', allFields: false, hideIsolated: false }));
    expect(renderSvg(placed)).not.toContain('<img');
  });
});

describe('塊の敷き詰め', () => {
  // デモの9アプリを3組に複製し、関係を持たないアプリを12個足す
  const many: Schema = structuredClone(schema);
  for (const k of [1, 2]) {
    const shift = (id: string) => String(Number(id) + k * 1000);
    many.apps.push(...schema.apps.map((a) => ({ ...a, id: shift(a.id), name: `${a.name}${k}` })));
    many.relations.push(...schema.relations.map((r) => ({ ...r, fromApp: shift(r.fromApp), toApp: shift(r.toApp) })));
  }
  for (let i = 0; i < 12; i++) {
    many.apps.push({ ...schema.apps[0], id: String(5000 + i), name: `単独${i}`, fields: schema.apps[0].fields.slice(0, 2) });
  }

  it('塊は大きい順に分かれる', () => {
    const graph = buildGraph(many, { space: 'all', allFields: false, hideIsolated: false });
    const groups = components(graph);
    expect(groups.map((g) => g.length).slice(0, 4)).toEqual([9, 9, 9, 1]);
    expect(groups).toHaveLength(15);
  });

  it('縦一列に積まず、横長に収める（重なりなし）', async () => {
    const placed = await layout(buildGraph(many, { space: 'all', allFields: false, hideIsolated: false }));
    const ratio = placed.width / placed.height;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
    for (const a of placed.nodes) for (const b of placed.nodes) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap).toBe(false);
    }
    // 線は自分の塊の中に収まる（端点がどこかの箱の縁にある）
    for (const e of placed.edges) {
      const [p, q] = [e.points[0], e.points[e.points.length - 1]];
      const near = (pt: { x: number; y: number }) => placed.nodes.some((n) =>
        pt.x >= n.x - 2 && pt.x <= n.x + n.width + 2 && pt.y >= n.y && pt.y <= n.y + n.height);
      expect(near(p) && near(q)).toBe(true);
    }
  });
});
