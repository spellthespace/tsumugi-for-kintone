// fixture から印刷用の HTML を作る（kintone に上げずに PDF の見た目を確かめる）
// 実行: npx tsx scripts/preview.ts [fixture.json] > dist/preview.html
import { readFileSync } from 'node:fs';
import { buildGraph } from '../src/view/graph';
import { layout } from '../src/view/layout';
import { renderSvg } from '../src/view/svg';
import { renderDocument } from '../src/view/document';
import type { Schema } from '../src/core/types';

const schema: Schema = JSON.parse(readFileSync(process.argv[2] ?? 'test/fixtures/demo-schema.json', 'utf8'));
const placed = await layout(buildGraph(schema, { space: 'all', allFields: false, hideIsolated: false }));
process.stdout.write(renderDocument({
  schema, apps: placed.nodes.map((n) => n.app), scopeLabel: 'プレビュー', svg: renderSvg(placed),
}));
