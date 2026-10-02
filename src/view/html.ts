const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML / SVG に埋め込む文字列のエスケープ（アプリ名・フィールド名はユーザー入力） */
export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
