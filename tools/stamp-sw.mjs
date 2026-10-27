// Met à jour la liste des fichiers mis en cache par le service worker et sa
// version (empreinte du contenu). À lancer après toute modification :
//   node tools/stamp-sw.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const include = ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons', 'vendor'];
const files = [];
const walk = (p) => {
  const st = statSync(p);
  if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (!/\.(map|md)$|LICENSE/.test(p)) files.push(relative(root, p));
};
for (const i of include) walk(join(root, i));
files.sort();
const h = createHash('sha256');
for (const f of files) { h.update(f); h.update(readFileSync(join(root, f))); }
const version = h.digest('hex').slice(0, 12);
const sw = readFileSync(join(root, 'sw.js'), 'utf8')
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = [\n  './',\n${files.map(f => `  './${f}',`).join('\n')}\n];`);
writeFileSync(join(root, 'sw.js'), sw);
console.log(`sw.js : version ${version}, ${files.length} fichiers`);
