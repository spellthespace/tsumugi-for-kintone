import type { SpaceFilter } from './graph';
import { esc } from './html';

// スペースを選ぶボタン＋一覧（ブラウザ標準の select の代わり）。
// 一覧はアプリ数のバッジつき。選択肢が多いときだけ検索欄を出す。

export interface Choice { value: SpaceFilter; label: string; count: number }

const SEARCH_THRESHOLD = 8;

export const PICKER_CSS = `
.ked-picker{position:relative}
.ked-picker-btn{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 10px 0 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:13px;color:#0f172a;cursor:pointer;max-width:440px;transition:border-color .15s,box-shadow .15s}
.ked-picker-btn:hover{border-color:#94a3b8}
.ked-picker-btn:focus-visible,.ked-picker.ked-open .ked-picker-btn{outline:none;border-color:#1e40af;box-shadow:0 0 0 3px rgba(30,64,175,.15)}
.ked-picker-btn:disabled{opacity:.55;cursor:default}
.ked-picker-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.ked-picker-caret{flex:none;color:#64748b;transition:transform .15s}
.ked-picker.ked-open .ked-picker-caret{transform:rotate(180deg)}
.ked-count{flex:none;min-width:20px;padding:1px 7px;border-radius:999px;background:#eef2ff;color:#1e40af;font-size:11px;font-weight:600;text-align:center}
.ked-pop{position:absolute;z-index:20;top:calc(100% + 6px);left:0;width:400px;min-width:100%;max-width:calc(100vw - 32px);background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.14);padding:6px;display:none}
.ked-picker.ked-open .ked-pop{display:block}
.ked-pop input{width:100%;box-sizing:border-box;height:32px;margin:2px 0 6px;padding:0 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px}
.ked-pop input:focus{outline:none;border-color:#1e40af}
.ked-list{max-height:320px;overflow:auto;margin:0;padding:0;list-style:none}
.ked-opt{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;font-size:13px;cursor:pointer}
.ked-opt-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ked-opt.ked-active{background:#f1f5f9}
.ked-opt[aria-selected=true]{color:#1e40af;font-weight:600}
.ked-opt[aria-selected=true] .ked-check{visibility:visible}
.ked-check{visibility:hidden;flex:none;color:#1e40af}
.ked-sep{height:1px;background:#e2e8f0;margin:4px 6px}
.ked-empty{padding:10px;color:#94a3b8;font-size:12px}
`;

const CARET = '<svg class="ked-picker-caret" width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg class="ked-check" width="14" height="14" viewBox="0 0 14 14"><path d="m3 7.5 2.5 2.5L11 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SPACE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" style="flex:none;color:#1e40af"><rect x="1.5" y="2.5" width="5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9.5" y="2.5" width="5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="5.5" y="9.5" width="5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 4.5h3M8 6.5v3" stroke="currentColor" stroke-width="1.4"/></svg>';

export class SpacePicker {
  readonly el: HTMLElement;
  private choices: Choice[] = [];
  private current: SpaceFilter = 'all';
  private active = 0;
  private visible: Choice[] = [];
  private btn: HTMLButtonElement;
  private list: HTMLElement;
  private search: HTMLInputElement;

  constructor(private onChange: (v: SpaceFilter) => void) {
    this.el = document.createElement('div');
    this.el.className = 'ked-picker';
    this.el.innerHTML =
      `<button type="button" class="ked-picker-btn" aria-haspopup="listbox" aria-expanded="false" disabled>` +
      `${SPACE_ICON}<span class="ked-picker-name">読み込み中…</span><span class="ked-count" hidden></span>${CARET}</button>` +
      `<div class="ked-pop"><input type="search" placeholder="スペースを検索" aria-label="スペースを検索">` +
      `<ul class="ked-list" role="listbox" tabindex="-1" aria-label="表示するスペース"></ul></div>`;
    this.btn = this.el.querySelector('.ked-picker-btn')!;
    this.list = this.el.querySelector('.ked-list')!;
    this.search = this.el.querySelector('input')!;

    this.btn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.search.addEventListener('input', () => { this.active = 0; this.renderList(); });
    this.el.addEventListener('keydown', (ev) => this.onKey(ev));
    this.list.addEventListener('pointermove', (ev) => {
      const li = (ev.target as Element).closest('.ked-opt') as HTMLElement | null;
      if (li) this.setActive(Number(li.dataset.i));
    });
    this.list.addEventListener('click', (ev) => {
      const li = (ev.target as Element).closest('.ked-opt') as HTMLElement | null;
      if (li) this.pick(this.visible[Number(li.dataset.i)]);
    });
    const outside = (ev: PointerEvent) => {
      // 再取得で作り直されたら、古いピッカーの監視を外す
      if (!this.el.isConnected) { document.removeEventListener('pointerdown', outside); return; }
      if (this.isOpen && !this.el.contains(ev.target as Node)) this.close();
    };
    document.addEventListener('pointerdown', outside);
  }

  get value() { return this.current; }
  get label() { return this.choices.find((c) => c.value === this.current)?.label ?? ''; }
  private get isOpen() { return this.el.classList.contains('ked-open'); }

  setChoices(choices: Choice[], value: SpaceFilter) {
    this.choices = choices;
    this.current = value;
    this.btn.disabled = false;
    this.search.hidden = choices.length < SEARCH_THRESHOLD;
    this.renderButton();
  }

  private renderButton() {
    const c = this.choices.find((x) => x.value === this.current);
    this.el.querySelector('.ked-picker-name')!.textContent = c?.label ?? '';
    const count = this.el.querySelector('.ked-count') as HTMLElement;
    count.hidden = !c;
    count.textContent = c ? String(c.count) : '';
    this.btn.title = c?.label ?? '';
  }

  private renderList() {
    const q = this.search.value.trim().toLowerCase();
    this.visible = this.choices.filter((c) => !q || c.label.toLowerCase().includes(q));
    if (!this.visible.length) {
      this.list.innerHTML = '<li class="ked-empty">一致するスペースがありません</li>';
      return;
    }
    // 「すべて」と「スペースなし」は、スペースの一覧と線で区切る
    this.list.innerHTML = this.visible.map((c, i) => {
      const prev = this.visible[i - 1];
      const sep = prev && (prev.value === 'all' || c.value === 'none') ? '<li class="ked-sep" role="separator"></li>' : '';
      return `${sep}<li class="ked-opt${i === this.active ? ' ked-active' : ''}" role="option" data-i="${i}" ` +
        `aria-selected="${c.value === this.current}">${CHECK}<span class="ked-opt-name" title="${esc(c.label)}">${esc(c.label)}</span>` +
        `<span class="ked-count">${c.count}</span></li>`;
    }).join('');
  }

  private setActive(i: number) {
    this.active = i;
    this.list.querySelectorAll('.ked-opt').forEach((li) =>
      li.classList.toggle('ked-active', Number((li as HTMLElement).dataset.i) === i));
    this.list.querySelector('.ked-active')?.scrollIntoView({ block: 'nearest' });
  }

  private open() {
    this.search.value = '';
    this.active = Math.max(0, this.choices.findIndex((c) => c.value === this.current));
    this.renderList();
    this.el.classList.add('ked-open');
    this.btn.setAttribute('aria-expanded', 'true');
    (this.search.hidden ? this.list : this.search).focus?.();
    this.list.querySelector('.ked-active')?.scrollIntoView({ block: 'nearest' });
  }

  private close() {
    this.el.classList.remove('ked-open');
    this.btn.setAttribute('aria-expanded', 'false');
  }

  private pick(c: Choice | undefined) {
    this.close();
    this.btn.focus();
    if (!c || c.value === this.current) return;
    this.current = c.value;
    this.renderButton();
    this.onChange(c.value);
  }

  private onKey(ev: KeyboardEvent) {
    if (!this.isOpen) {
      if (ev.key === 'ArrowDown' && ev.target === this.btn) { ev.preventDefault(); this.open(); }
      return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); this.close(); this.btn.focus(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); this.setActive(Math.min(this.active + 1, this.visible.length - 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); this.setActive(Math.max(this.active - 1, 0)); }
    else if (ev.key === 'Enter') { ev.preventDefault(); this.pick(this.visible[this.active]); }
  }
}
