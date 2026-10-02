import ELK from 'elkjs/lib/elk.bundled.js';
import type { Graph, GraphEdge, GraphNode } from './graph';

// elkjs でアプリの箱と線の位置を計算する。
// 線はフィールドの行から行へ引く（各行の左右にポートを置く）。

export const METRICS = {
  headerHeight: 34,
  rowHeight: 20,
  footerHeight: 18,
  padX: 10,
  fontSize: 12,
  minWidth: 170,
  maxWidth: 320,
};

/** 文字幅の見積もり。印刷用のHTMLでも同じ値を使うため、実測せずに見積もる */
export function textWidth(s: string, fontSize = METRICS.fontSize) {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? fontSize * 0.6 : fontSize;
  return w;
}

export interface Point { x: number; y: number }

export interface PlacedNode extends GraphNode {
  x: number; y: number; width: number; height: number;
}

export interface PlacedEdge extends GraphEdge {
  points: Point[];
}

export interface Placed {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

function rowLabel(node: GraphNode, i: number) {
  const f = node.rows[i].field;
  return `${f.subtable ? '　' : ''}${f.label}`;
}

function nodeSize(node: GraphNode) {
  const texts = [
    textWidth(node.app.name, 14) + 40,
    ...node.rows.map((_, i) => textWidth(rowLabel(node, i)) + 2 * METRICS.padX + 70),
  ];
  const width = Math.min(METRICS.maxWidth, Math.max(METRICS.minWidth, ...texts));
  const height = METRICS.headerHeight + node.rows.length * METRICS.rowHeight +
    (node.hidden ? METRICS.footerHeight : 6);
  return { width, height };
}

const rowY = (index: number) => METRICS.headerHeight + index * METRICS.rowHeight + METRICS.rowHeight / 2;

export async function layout(graph: Graph): Promise<Placed> {
  const elk = new ELK();
  const rowIndex = new Map<string, number>();
  for (const n of graph.nodes) for (const r of n.rows) rowIndex.set(`${n.app.id}:${r.field.code}`, r.index);

  const children = graph.nodes.map((n) => {
    const { width, height } = nodeSize(n);
    const ports = [
      { id: `${n.app.id}#hE`, x: width, y: METRICS.headerHeight / 2, side: 'EAST' },
      { id: `${n.app.id}#hW`, x: -1, y: METRICS.headerHeight / 2, side: 'WEST' },
      ...n.rows.flatMap((r) => [
        { id: `${n.app.id}#${r.index}E`, x: width, y: rowY(r.index), side: 'EAST' },
        { id: `${n.app.id}#${r.index}W`, x: -1, y: rowY(r.index), side: 'WEST' },
      ]),
    ].map((p) => ({ id: p.id, x: p.x, y: p.y, width: 1, height: 1, layoutOptions: { 'elk.port.side': p.side } }));
    return {
      id: n.app.id, width, height, ports,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
    };
  });

  const port = (app: string, field: string | null, side: 'E' | 'W') => {
    const i = field === null ? undefined : rowIndex.get(`${app}:${field}`);
    return i === undefined ? `${app}#h${side}` : `${app}#${i}${side}`;
  };
  // ルックアップは「マスタ → 参照する側」の向きで配置する。関連レコード一覧・アクションは
  // 「親 → 子」なので、向きが揃って左から右へ流れる図になる（逆向きの線が大回りしない）
  const edges = graph.edges.map((e) => {
    const r = e.relation;
    const forward = r.kind !== 'lookup';
    const [sApp, sField, tApp, tField] = forward
      ? [r.fromApp, r.fromField, r.toApp, r.toField]
      : [r.toApp, r.toField, r.fromApp, r.fromField];
    return { id: e.id, sources: [port(sApp, sField, 'E')], targets: [port(tApp, tField, 'W')] };
  });

  // つながっているアプリの塊ごとに配置を計算し、塊を横長に敷き詰める
  // （ELK に任せると、つながっていない塊が縦一列に積まれて縦長になる）
  const groups = components(graph);
  const parts = await Promise.all(groups.map(async (ids) => {
    const set = new Set(ids);
    const r: any = await elk.layout({
      id: 'root',
      layoutOptions: LAYOUT_OPTIONS,
      children: children.filter((c) => set.has(c.id)),
      edges: edges.filter((e) => set.has(appOf(e.sources[0]))),
    });
    return r;
  }));
  const offsets = pack(parts.map((r) => ({ w: r.width ?? 0, h: r.height ?? 0 })));

  const byId = new Map(graph.nodes.map((n) => [n.app.id, n]));
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const nodes: PlacedNode[] = [];
  const placedEdges: PlacedEdge[] = [];
  parts.forEach((r, i) => {
    const { x: dx, y: dy } = offsets.positions[i];
    for (const c of r.children ?? []) {
      nodes.push({ ...byId.get(c.id)!, x: dx + (c.x ?? 0), y: dy + (c.y ?? 0), width: c.width ?? 0, height: c.height ?? 0 });
    }
    for (const e of r.edges ?? []) {
      const sec = e.sections?.[0];
      const pts: Point[] = sec ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint] : [];
      placedEdges.push({ ...edgeById.get(e.id)!, points: pts.map((pt) => ({ x: dx + pt.x, y: dy + pt.y })) });
    }
  });
  return { nodes, edges: placedEdges, width: offsets.width + PAD, height: offsets.height + PAD };
}

const PAD = 24;
const GAP = 48;
/** 敷き詰めたときの横:縦の目安（画面・A3横に近い比率） */
const ASPECT = 1.6;

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '36',
  'elk.spacing.edgeEdge': '8',
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.padding': '[top=0,left=0,bottom=0,right=0]',
};

const appOf = (portId: string) => portId.slice(0, portId.indexOf('#'));

/** 線でつながっているアプリの塊に分ける。大きい塊から順に返す */
export function components(graph: Graph): string[][] {
  const parent = new Map(graph.nodes.map((n) => [n.app.id, n.app.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  };
  for (const e of graph.edges) parent.set(find(e.relation.fromApp), find(e.relation.toApp));
  const groups = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const root = find(n.app.id);
    groups.set(root, [...(groups.get(root) ?? []), n.app.id]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/** 決まった幅で棚詰めする（左上から横に並べ、幅を超えたら次の段へ） */
function shelf(sizes: { w: number; h: number }[], limit: number) {
  const positions: { x: number; y: number }[] = [];
  let x = PAD, y = PAD, row = 0, width = 0;
  for (const b of sizes) {
    if (x > PAD && x + b.w > PAD + limit) { x = PAD; y += row + GAP; row = 0; }
    positions.push({ x, y });
    x += b.w + GAP;
    row = Math.max(row, b.h);
    width = Math.max(width, x - GAP);
  }
  return { positions, width, height: y + row };
}

/**
 * 塊を敷き詰める。棚の幅を何通りか試し、全体の比率が ASPECT に一番近いものを選ぶ
 * （面積だけで幅を決めると、縦長の大きな塊が1段を占領して全体が縦長になる）
 */
export function pack(sizes: { w: number; h: number }[]) {
  const widest = Math.max(0, ...sizes.map((b) => b.w));
  const total = sizes.reduce((s, b) => s + b.w + GAP, 0);
  let best = shelf(sizes, widest);
  let bestScore = Infinity;
  for (let i = 0; i <= 40; i++) {
    const limit = widest + ((total - widest) * i) / 40;
    const r = shelf(sizes, limit);
    const score = Math.abs(Math.log(r.width / Math.max(1, r.height)) - Math.log(ASPECT));
    if (score < bestScore - 1e-9) { best = r; bestScore = score; }
  }
  return best;
}
