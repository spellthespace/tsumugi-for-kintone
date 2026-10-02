import type { RelationKind } from '../core/types';
import { METRICS, type Placed, type PlacedEdge, type PlacedNode, type Point } from './layout';
import { esc } from './html';

// 配置済みの図を SVG 文字列にする。画面表示と印刷（PDF）で同じものを使う。

const SHORT_TYPE: Record<string, string> = {
  SINGLE_LINE_TEXT: '文字列', MULTI_LINE_TEXT: '文字列(複)', RICH_TEXT: 'リッチ', NUMBER: '数値', CALC: '計算',
  RADIO_BUTTON: 'ラジオ', CHECK_BOX: 'チェック', MULTI_SELECT: '複数選択', DROP_DOWN: 'ドロップ', DATE: '日付',
  TIME: '時刻', DATETIME: '日時', FILE: '添付', LINK: 'リンク', USER_SELECT: 'ユーザー', ORGANIZATION_SELECT: '組織',
  GROUP_SELECT: 'グループ', REFERENCE_TABLE: '関連一覧', SUBTABLE: 'テーブル', LOOKUP: 'ルックアップ',
};

export const EDGE_STYLE: Record<RelationKind, { color: string; dash: string; name: string }> = {
  lookup: { color: '#334155', dash: '', name: 'ルックアップ' },
  related: { color: '#0d9488', dash: '6 4', name: '関連レコード一覧' },
  action: { color: '#ea580c', dash: '2 4', name: 'アプリアクション' },
};

// スペースごとに見出しの色を変える（同じスペースは同じ色。図に出てくる順に割り当てる）
const PALETTE = ['#1e40af', '#047857', '#6d28d9', '#0e7490', '#9d174d', '#4d7c0f', '#92400e', '#7c2d12'];
function headerColors(nodes: PlacedNode[]) {
  const ids = [...new Set(nodes.map((n) => n.app.spaceId).filter((x): x is string => !!x))]
    .sort((a, b) => Number(a) - Number(b));
  const map = new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
  return (spaceId: string | null) => (spaceId ? map.get(spaceId)! : '#475569');
}

function truncate(s: string, maxWidth: number, fontSize: number) {
  let w = 0;
  let out = '';
  for (const ch of s) {
    w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? fontSize * 0.6 : fontSize;
    if (w > maxWidth) return `${out}…`;
    out += ch;
  }
  return out;
}

function node(n: PlacedNode, color: string) {
  const { x, y, width } = n;
  const rows = n.rows.map((r) => {
    const f = r.field;
    const ry = METRICS.headerHeight + r.index * METRICS.rowHeight;
    const indent = f.subtable ? 14 : 0;
    const badge = f.unique ? '<tspan class="ked-key">◆ </tspan>' : f.subtable ? '<tspan class="ked-sub">└ </tspan>' : '';
    const label = truncate(f.label, width - 2 * METRICS.padX - indent - 72, METRICS.fontSize);
    const type = SHORT_TYPE[f.type] ?? f.type;
    return `<g class="ked-row" data-field="${esc(f.code)}">` +
      (r.index % 2 ? `<rect x="1" y="${ry}" width="${width - 2}" height="${METRICS.rowHeight}" fill="#f8fafc"/>` : '') +
      `<text x="${METRICS.padX + indent}" y="${ry + 14}" class="ked-field">${badge}${esc(label)}<title>${esc(f.label)}（${esc(f.code)}）${f.note ? '\n' + esc(f.note) : ''}</title></text>` +
      `<text x="${width - METRICS.padX}" y="${ry + 14}" class="ked-type" text-anchor="end">${esc(type)}</text>` +
      `</g>`;
  }).join('');
  const footer = n.hidden
    ? `<text x="${METRICS.padX}" y="${n.height - 5}" class="ked-more">ほか ${n.hidden} フィールド</text>`
    : '';
  const title = truncate(n.app.name, width - 56, 14);
  return `<g class="ked-node" data-app="${esc(n.app.id)}" transform="translate(${x},${y})">` +
    `<rect width="${width}" height="${n.height}" rx="6" fill="#fff" stroke="#cbd5e1"/>` +
    `<path d="M0 6a6 6 0 0 1 6-6h${width - 12}a6 6 0 0 1 6 6v${METRICS.headerHeight - 6}h-${width}z" fill="${color}"/>` +
    `<text x="${METRICS.padX}" y="22" class="ked-app">${esc(title)}<title>${esc(n.app.name)}${n.app.spaceName ? `（${esc(n.app.spaceName)}）` : ''}</title></text>` +
    `<text x="${width - METRICS.padX}" y="22" class="ked-appid" text-anchor="end">#${esc(n.app.id)}</text>` +
    rows + footer + `</g>`;
}

/** 角を少し丸めた折れ線 */
function pathOf(points: Point[]) {
  if (points.length < 2) return '';
  const r = 6;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
    const d1 = Math.min(r, Math.hypot(c.x - p.x, c.y - p.y) / 2);
    const d2 = Math.min(r, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const a = { x: c.x - Math.sign(c.x - p.x) * d1, y: c.y - Math.sign(c.y - p.y) * d1 };
    const b = { x: c.x + Math.sign(n.x - c.x) * d2, y: c.y + Math.sign(n.y - c.y) * d2 };
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x},${last.y}`;
}

function edge(e: PlacedEdge) {
  const s = EDGE_STYLE[e.relation.kind];
  // ルックアップの線は配置の都合でマスタ側から引いている（始点＝1、終点＝多）
  const markers = e.relation.kind === 'lookup'
    ? 'marker-start="url(#ked-one)" marker-end="url(#ked-many)"'
    : `marker-end="url(#ked-arrow-${e.relation.kind})"`;
  return `<g class="ked-edge" data-from="${esc(e.relation.fromApp)}" data-to="${esc(e.relation.toApp)}">` +
    `<path d="${pathOf(e.points)}" fill="none" stroke="transparent" stroke-width="10"/>` +
    `<path d="${pathOf(e.points)}" fill="none" stroke="${s.color}" stroke-width="1.5" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} ${markers}/>` +
    `<title>${esc(s.name)}: ${esc(e.relation.label)}</title></g>`;
}

const STYLE = `
.ked-app{font:600 14px sans-serif;fill:#fff}
.ked-appid{font:11px sans-serif;fill:rgba(255,255,255,.75)}
.ked-field{font:12px sans-serif;fill:#0f172a}
.ked-type{font:10px sans-serif;fill:#64748b}
.ked-key{fill:#b45309}
.ked-sub{fill:#94a3b8}
.ked-more{font:10px sans-serif;fill:#94a3b8}
.ked-dim{opacity:.18}
`;

function defs() {
  const arrow = (kind: RelationKind) =>
    `<marker id="ked-arrow-${kind}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${EDGE_STYLE[kind].color}"/></marker>`;
  const c = EDGE_STYLE.lookup.color;
  return `<defs>${arrow('related')}${arrow('action')}` +
    // 多（ルックアップを持つ側・線の終点）: カラスの足
    `<marker id="ked-many" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto">` +
    `<path d="M1,6 L11,1 M1,6 L11,11 M1,6 L11,6" stroke="${c}" stroke-width="1.3" fill="none"/></marker>` +
    // 1（参照される側・線の始点）: 縦棒
    `<marker id="ked-one" viewBox="0 0 12 12" refX="1" refY="6" markerWidth="12" markerHeight="12" orient="auto">` +
    `<path d="M6,1 L6,11" stroke="${c}" stroke-width="1.5"/></marker></defs>`;
}

export function legend() {
  return Object.values(EDGE_STYLE).map((s) =>
    `<span class="ked-legend-item"><svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" stroke="${s.color}" stroke-width="2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/></svg>${esc(s.name)}</span>`,
  ).join('') + '<span class="ked-legend-item"><b style="color:#b45309">◆</b> 重複禁止（キー）</span>';
}

export function renderSvg(placed: Placed, attrs = '') {
  const color = headerColors(placed.nodes);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${placed.width} ${placed.height}" ${attrs}>` +
    `<style>${STYLE}</style>${defs()}` +
    `<g class="ked-edges">${placed.edges.map(edge).join('')}</g>` +
    `<g class="ked-nodes">${placed.nodes.map((n) => node(n, color(n.app.spaceId))).join('')}</g></svg>`;
}
