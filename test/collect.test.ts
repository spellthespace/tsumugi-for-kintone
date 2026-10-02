import { describe, expect, it } from 'vitest';
import { collectSchema } from '../src/core/collect';
import type { ApiFn } from '../src/core/types';

// 権限が足りない人が開いたときを、APIの失敗で再現する
const forbidden = () => Promise.reject({ code: 'CB_NO02', message: '権限がありません。' });

const fields = {
  1: {
    properties: {
      注文番号: { type: 'SINGLE_LINE_TEXT', code: '注文番号', label: '注文番号', unique: true, required: true },
      // 参照先のアプリ99は、この人には見えない
      顧客コード: {
        type: 'SINGLE_LINE_TEXT', code: '顧客コード', label: '顧客コード',
        lookup: { relatedApp: { app: '99' }, relatedKeyField: 'コード', fieldMappings: [] },
      },
      商品コード: {
        type: 'SINGLE_LINE_TEXT', code: '商品コード', label: '商品コード',
        lookup: { relatedApp: { app: '2' }, relatedKeyField: 'コード', fieldMappings: [] },
      },
    },
  },
} as Record<string, any>;

const api: ApiFn = async (path, _m, params: any) => {
  switch (path) {
    case '/k/v1/apps':
      return { apps: [{ appId: '1', name: '注文', spaceId: '7' }, { appId: '2', name: '商品', spaceId: '7' }] };
    case '/k/v1/space':
      return forbidden(); // 非公開スペース
    case '/k/v1/app/form/fields':
      return fields[params.app] ?? forbidden();
    case '/k/v1/app/form/layout':
      return forbidden();
    case '/k/v1/app/actions':
      return params.app === '1' ? { actions: {} } : forbidden(); // アプリ管理権限なし
    default:
      throw new Error(`unexpected ${path}`);
  }
};

describe('権限が足りないとき', () => {
  it('取れないものは警告に回し、取れた分で図を作る', async () => {
    const schema = await collectSchema(api);
    expect(schema.apps.map((a) => a.name)).toEqual(['注文', '商品']);
    // 見えないアプリ99への線は出さず、見えるアプリ2への線は出す
    expect(schema.relations.map((r) => r.toApp)).toEqual(['2']);
    expect(schema.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('商品（2）: フィールドを取得できませんでした'),
      expect.stringContaining('商品（2）: アクションを取得できませんでした'),
      expect.stringContaining('参照先アプリ99は、閲覧権限がないため図に出せません'),
    ]));
    // スペース名が取れなくても止まらない
    expect(schema.apps[0].spaceName).toBe('スペース7');
  });
});
