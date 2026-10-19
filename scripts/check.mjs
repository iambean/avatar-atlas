import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateCatalog} from '../lib/install.mjs';
const catalog=validateCatalog(JSON.parse(await readFile('site-dist/manifest.json','utf8')));
assert.equal(catalog.items.length,80);assert.equal(catalog.categories.length,6);
assert.equal(catalog.defaultAvatarId,'geometry-02');
for(const category of catalog.categories) assert.equal(catalog.items.filter(a=>a.category===category.id).length,['realistic','cartoon'].includes(category.id)?20:10);
for(const category of ['realistic','cartoon']){
 const people=catalog.items.filter(a=>a.category===category);assert.equal(people.filter(a=>a.gender==='female').length,10);assert.ok(people.every(a=>a.age>=18&&a.age<=40));
}
for(const a of catalog.items){
 for(const path of Object.values(a.formats)) {assert.ok(path.startsWith('/avatar-atlas/avatars/v1/'));assert.ok((await stat('site-dist/'+path.slice('/avatar-atlas/'.length))).size>0);}
 assert.equal(createHash('sha256').update(await readFile(`assets/${a.id}.webp`)).digest('hex'),a.sha256);
}
const html=await readFile('site-dist/index.html','utf8');
assert.ok(html.includes('github:iambean/avatar-atlas#v1.3.0'));
assert.ok(!/(?:href|src)="\/(?!\/)/.test(html),'HTML must work under project subpath');
assert.ok(!/<(?:script|img)[^>]+src="https?:\/\//i.test(html),'Runtime resources must stay local');
for(const match of html.matchAll(/(?:src|href)="\.\/([^"?#]*)/g)) await stat('site-dist/'+match[1]);
execFileSync(process.execPath,['--check','site-dist/app.js']);
execFileSync('unzip',['-tq','site-dist/downloads/avatar-atlas-v1.zip']);
console.log('Verified 80 assets, categories, gender/age ranges, paths, hashes, downloads and local runtime resources.');
