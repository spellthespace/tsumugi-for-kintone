import { collectSchema } from '../core/collect';
import type { ApiFn, Schema } from '../core/types';
import { renderDocument } from './document';
import { buildGraph, spaceChoices, type GraphOptions, type SpaceFilter } from './graph';
import { esc } from './html';
import { layout, type Placed } from './layout';
import { SpacePicker, PICKER_CSS } from './space-picker';
import { legend, renderSvg } from './svg';

// kintone のカスタムビューの中に、ツールバーと図を出す。

const STORAGE_KEY = 'tsumugi:options';
/** 取得結果をタブの中で覚えておく時間。開き直すたびにアプリ数×3回の API を呼ばないため */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cacheKey = (selfAppId: string) => `tsumugi:schema:${selfAppId}`;

function readCache(key: string): Schema | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Schema | null;
    return s && Date.now() - Date.parse(s.fetchedAt) < CACHE_TTL_MS ? s : null;
  } catch { return null; }
}
function writeCache(key: string, s: Schema) {
  try { sessionStorage.setItem(key, JSON.stringify(s)); } catch { /* 容量超過などは覚えないだけ */ }
}
const ICON_RELOAD = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M12 7a5 5 0 1 1-1.5-3.6M12 1.5V4H9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

const CSS = `
.ked{font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif;color:#0f172a;border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden}
.ked-bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:10px 14px;background:#fff;border-bottom:1px solid #eef2f7}
.ked-group{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ked-toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#334155;cursor:pointer;user-select:none}
.ked-toggle input{position:absolute;opacity:0;pointer-events:none}
.ked-switch{position:relative;width:32px;height:18px;border-radius:999px;background:#cbd5e1;transition:background .15s;flex:none}
.ked-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.25);transition:transform .15s}
.ked-toggle input:checked+.ked-switch{background:#1e40af}
.ked-toggle input:checked+.ked-switch::after{transform:translateX(14px)}
.ked-toggle input:focus-visible+.ked-switch{box-shadow:0 0 0 3px rgba(30,64,175,.2)}
.ked-spacer{flex:1}
.ked-status{font-size:12px;color:#64748b;white-space:nowrap}
.ked-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;font-size:13px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;cursor:pointer;transition:background .15s,border-color .15s}
.ked-btn:hover:not(:disabled){background:#f8fafc;border-color:#94a3b8}
.ked-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(30,64,175,.2)}
.ked-btn.ked-primary{background:#1e40af;border-color:#1e40af;color:#fff;font-weight:600}
.ked-btn.ked-primary:hover:not(:disabled){background:#1e3a8a;border-color:#1e3a8a}
.ked-btn:disabled{opacity:.5;cursor:default}
.ked-legend{font-size:12px;color:#475569;padding:7px 14px;background:#f8fafc;border-bottom:1px solid #eef2f7;display:flex;flex-wrap:wrap;gap:4px}
.ked-legend-item{display:inline-flex;align-items:center;gap:6px;margin-right:14px}
.ked-canvas{position:relative;height:calc(100vh - 350px);min-height:420px;overflow:hidden;background:#fff;background-image:radial-gradient(#e2e8f0 1px,transparent 1px);background-size:20px 20px;cursor:grab;touch-action:none}
.ked-canvas.ked-drag{cursor:grabbing}
.ked-canvas svg{width:100%;height:100%;display:block;user-select:none}
.ked-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:14px}
.ked-warn{font-size:12px;color:#b45309;padding:8px 14px;border-top:1px solid #eef2f7}
.ked-warn summary{cursor:pointer}
.ked-node{cursor:default}
${PICKER_CSS}
`;

const ICON_FIT = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PDF = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v7m0 0L4 5.5m3 3 3-3M2 10v2.5h10V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface Saved { space?: SpaceFilter; allFields?: boolean; hideIsolated?: boolean }

function load(): Saved {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
}
function save(v: Saved) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* 保存できなくても動く */ }
}

export interface ViewerOptions {
  api: ApiFn;
  /** ビューア自身のアプリ（図から除く） */
  selfAppId: string;
  /** 最初に選ぶスペース（ビューアが置かれたスペース） */
  defaultSpace: SpaceFilter;
  /** 覚えておいた取得結果を使わずに取り直す */
  forceReload?: boolean;
}

export async function mountViewer(root: HTMLElement, opts: ViewerOptions) {
  root.innerHTML = `<style>${CSS}</style><div class="ked">
    <div class="ked-bar">
      <div class="ked-group">
        <span class="ked-picker-slot"></span>
        <label class="ked-toggle"><input type="checkbox" class="ked-all"><span class="ked-switch"></span>全フィールド</label>
        <label class="ked-toggle"><input type="checkbox" class="ked-iso"><span class="ked-switch"></span>関係のないアプリを隠す</label>
      </div>
      <span class="ked-spacer"></span>
      <span class="ked-status">読み込み中…</span>
      <button type="button" class="ked-btn ked-reload" title="アプリの構成を取り直す" disabled>${ICON_RELOAD}再取得</button>
      <button type="button" class="ked-btn ked-fit" disabled>${ICON_FIT}全体を表示</button>
      <button type="button" class="ked-btn ked-primary ked-print" disabled>${ICON_PDF}PDFで出力</button>
    </div>
    <div class="ked-legend">${legend()}</div>
    <div class="ked-canvas"><div class="ked-msg">アプリの構成を取得しています…</div></div>
    <div class="ked-warnings"></div>
  </div>`;
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const picker = new SpacePicker(() => redraw());
  $<HTMLElement>('.ked-picker-slot').replaceWith(picker.el);
  const allBox = $<HTMLInputElement>('.ked-all');
  const isoBox = $<HTMLInputElement>('.ked-iso');
  const status = $<HTMLElement>('.ked-status');
  const canvas = $<HTMLElement>('.ked-canvas');
  const fitBtn = $<HTMLButtonElement>('.ked-fit');
  const printBtn = $<HTMLButtonElement>('.ked-print');

  let schema: Schema;
  try {
    const cached = opts.forceReload ? null : readCache(cacheKey(opts.selfAppId));
    schema = cached ?? await collectSchema(opts.api, {
      excludeAppIds: [opts.selfAppId],
      onProgress: (d, t) => { status.textContent = `取得中 ${d} / ${t} アプリ`; },
    });
    if (!cached) writeCache(cacheKey(opts.selfAppId), schema);
  } catch (e) {
    canvas.innerHTML = `<div class="ked-msg">取得に失敗しました: ${esc((e as Error).message ?? String(e))}</div>`;
    status.textContent = '';
    return;
  }

  const saved = load();
  const choices = spaceChoices(schema);
  const initial = [saved.space, opts.defaultSpace].find((v) => v && choices.some((c) => c.value === v)) ?? 'all';
  picker.setChoices(choices, initial);
  allBox.checked = saved.allFields ?? false;
  isoBox.checked = saved.hideIsolated ?? false;

  if (schema.warnings.length) {
    $<HTMLElement>('.ked-warnings').innerHTML = `<details class="ked-warn"><summary>取得できなかった情報が ${schema.warnings.length} 件あります（権限不足など）</summary><ul>` +
      schema.warnings.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul></details>';
  }

  // --- 拡大縮小・移動（viewBox を動かす） ---
  let placed: Placed | null = null;
  let view = { x: 0, y: 0, w: 1, h: 1 };
  const svgEl = () => canvas.querySelector('svg');
  const applyView = () => svgEl()?.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const fit = () => {
    if (!placed) return;
    const r = canvas.getBoundingClientRect();
    const scale = Math.max(placed.width / r.width, placed.height / r.height, 0.6);
    view = { w: r.width * scale, h: r.height * scale, x: 0, y: 0 };
    view.x = (placed.width - view.w) / 2;
    view.y = (placed.height - view.h) / 2;
    applyView();
  };
  canvas.addEventListener('wheel', (ev) => {
    if (!placed) return;
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const k = Math.exp(ev.deltaY * 0.0015);
    const px = view.x + ((ev.clientX - r.left) / r.width) * view.w;
    const py = view.y + ((ev.clientY - r.top) / r.height) * view.h;
    view = { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k };
    applyView();
  }, { passive: false });
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;
  canvas.addEventListener('pointerdown', (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('ked-drag');
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    view.x = drag.vx - ((ev.clientX - drag.x) / r.width) * view.w;
    view.y = drag.vy - ((ev.clientY - drag.y) / r.height) * view.h;
    applyView();
  });
  const endDrag = () => { drag = null; canvas.classList.remove('ked-drag'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // アプリにカーソルを載せたら、そのアプリにつながる線と相手だけを強調する
  canvas.addEventListener('pointerover', (ev) => {
    const node = (ev.target as Element).closest?.('.ked-node');
    const svg = svgEl();
    if (!svg || drag) return;
    const id = node?.getAttribute('data-app');
    svg.querySelectorAll('.ked-dim').forEach((el) => el.classList.remove('ked-dim'));
    if (!id) return;
    const linked = new Set([id]);
    svg.querySelectorAll('.ked-edge').forEach((e) => {
      const f = e.getAttribute('data-from')!; const t = e.getAttribute('data-to')!;
      if (f === id || t === id) { linked.add(f); linked.add(t); } else e.classList.add('ked-dim');
    });
    svg.querySelectorAll('.ked-node').forEach((n) => {
      if (!linked.has(n.getAttribute('data-app')!)) n.classList.add('ked-dim');
    });
  });

  const options = (): GraphOptions => ({
    space: picker.value, allFields: allBox.checked, hideIsolated: isoBox.checked,
  });

  let seq = 0;
  const redraw = async () => {
    const my = ++seq;
    const o = options();
    save(o);
    const graph = buildGraph(schema, o);
    if (!graph.nodes.length) {
      placed = null;
      canvas.innerHTML = '<div class="ked-msg">表示できるアプリがありません</div>';
      status.textContent = '';
      fitBtn.disabled = printBtn.disabled = true;
      return;
    }
    status.textContent = '配置を計算中…';
    const p = await layout(graph);
    if (my !== seq) return; // 計算中に条件が変わった
    placed = p;
    canvas.innerHTML = renderSvg(p);
    fit();
    status.textContent = `${graph.nodes.length} アプリ・${graph.edges.length} 本の関係（${time(schema.fetchedAt)} 時点）`;
    fitBtn.disabled = printBtn.disabled = false;
  };

  allBox.addEventListener('change', redraw);
  isoBox.addEventListener('change', redraw);
  fitBtn.addEventListener('click', fit);
  const reloadBtn = $<HTMLButtonElement>('.ked-reload');
  reloadBtn.disabled = false;
  reloadBtn.addEventListener('click', () => { mountViewer(root, { ...opts, forceReload: true }); });
  printBtn.addEventListener('click', () => {
    if (!placed) return;
    const w = window.open('', '_blank');
    if (!w) { alert('ポップアップがブロックされました。このサイトのポップアップを許可してください。'); return; }
    const apps = placed.nodes.map((n) => n.app);
    w.document.write(renderDocument({ schema, apps, scopeLabel: picker.label, svg: renderSvg(placed) }));
    w.document.close();
    w.addEventListener('load', () => setTimeout(() => w.print(), 300));
  });

  await redraw();
}
