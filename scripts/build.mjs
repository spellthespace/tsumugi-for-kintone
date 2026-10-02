// dist/plugin にプラグインの中身（manifest・画像・バンドル済みJS）を組み立てる
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

rmSync('dist/plugin', { recursive: true, force: true });
mkdirSync('dist/plugin/js', { recursive: true });
cpSync('plugin', 'dist/plugin', { recursive: true });
// プラグインの zip には manifest に書いたファイルしか入らない。
// 同梱する elkjs（EPL-2.0）のライセンス文を確実に配るため、JS の末尾にコメントで全文を入れる
const licenseComment = ['LICENSE', 'THIRD_PARTY_LICENSES.txt']
  .map((f) => readFileSync(f, 'utf8').replaceAll('*/', '* /'))
  .join('\n\n');
await build({
  entryPoints: ['src/desktop.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'eof',
  banner: { js: '/*! Tsumugi for kintone | MIT License | Ｓｐｅｌｌ Ｔｈｅ Ｓｐａｃｅ合同会社 | bundles elkjs (EPL-2.0, https://github.com/kieler/elkjs) - license texts at the end of this file */' },
  footer: { js: `/*!\n${licenseComment}\n*/` },
  outfile: 'dist/plugin/js/desktop.js',
});
console.log('built dist/plugin');
