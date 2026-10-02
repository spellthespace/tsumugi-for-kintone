// kintone から取得したアプリ構成を、描画・定義書の両方で使う形にしたモデル。

/** kintone REST API を呼ぶ関数。プラグインでは kintone.api、Node では fetch で実装する */
export type ApiFn = (path: string, method: 'GET', params: Record<string, unknown>) => Promise<any>;

export type RelationKind = 'lookup' | 'related' | 'action';

export interface FieldInfo {
  code: string;
  label: string;
  type: string;
  required: boolean;
  unique: boolean;
  /** テーブル内のフィールドなら、そのテーブルのフィールドコード */
  subtable?: string;
  /** 定義書の備考欄（ルックアップ先・計算式・選択肢など） */
  note: string;
}

export interface AppInfo {
  id: string;
  name: string;
  spaceId: string | null;
  spaceName: string | null;
  description: string;
  /** フォームの並び順（テーブル内のフィールドはテーブルの直後） */
  fields: FieldInfo[];
}

export interface Relation {
  kind: RelationKind;
  /** 関係を持っている側（ルックアップ・関連レコード一覧・アクションを設定したアプリ） */
  fromApp: string;
  fromField: string | null;
  /** 参照先のアプリ */
  toApp: string;
  toField: string | null;
  label: string;
}

export interface Schema {
  fetchedAt: string;
  apps: AppInfo[];
  relations: Relation[];
  /** 権限不足などで取れなかったもの */
  warnings: string[];
}
