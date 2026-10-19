import {readFile, writeFile, mkdir, cp, rm, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {validateCatalog} from '../lib/install.mjs';
const catalog = validateCatalog(JSON.parse(await readFile('catalog.json','utf8')));
const media = JSON.parse(await readFile('media.json','utf8'));
const hash = bytes=>createHash('sha256').update(bytes).digest('hex');
const cache = '.local/media.zip';
await mkdir('.local',{recursive:true});
let bytes;
try{bytes=await readFile(cache);}catch(error){if(error.code!=='ENOENT')throw error;}
if(!bytes || hash(bytes)!==media.sha256){
  const response = await fetch(media.url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok) throw Error('Media download: HTTP '+response.status);
  bytes = Buffer.from(await response.arrayBuffer());
  if(hash(bytes)!==media.sha256) throw Error('Media checksum mismatch');
  await writeFile(cache,bytes);
}
const expected = new Set(catalog.items.flatMap(a=>Object.values(a.formats).map(p=>'avatars/v1/'+p.split('/').at(-1))));
const entries = execFileSync('unzip',['-Z1',cache],{encoding:'utf8'}).trim().split('\n');
for(const entry of entries) if(!expected.has(entry) && !['avatars/','avatars/v1/'].includes(entry)) throw Error('Unexpected media entry: '+entry);
for(const file of expected) if(!entries.includes(file)) throw Error('Missing media entry: '+file);
await rm('.local/media',{recursive:true,force:true});await mkdir('.local/media',{recursive:true});
execFileSync('unzip',['-q',resolve(cache),'-d','.local/media']);
for(const a of catalog.items){
  const bytes=await readFile(`.local/media/avatars/v1/${a.id}.webp`);
  if(hash(bytes)!==a.sha256 || !bytes.equals(await readFile(`assets/${a.id}.webp`))) throw Error('WebP content mismatch: '+a.id);
}
await rm('site-dist',{recursive:true,force:true});
await cp('web','site-dist',{recursive:true});
await cp('.local/media/avatars','site-dist/avatars',{recursive:true});
await writeFile('site-dist/manifest.json',JSON.stringify(catalog,null,2)+'\n');
await copyFile('site-dist/manifest.json','site-dist/avatars/v1/manifest.json');
await copyFile('ASSET-LICENSE.txt','site-dist/LICENSE.txt');
await writeFile('site-dist/provenance.json',JSON.stringify({version:catalog.version,note:'仿真人物均为 AI 生成的虚构形象。',items:catalog.items.map(({id,category,title,creationMethod,license})=>({id,category,title,creationMethod,license}))},null,2)+'\n');
await writeFile('site-dist/.nojekyll','');
await writeFile('site-dist/robots.txt',`User-agent: *\nAllow: /\nSitemap: ${catalog.baseUrl}/sitemap.xml\n`);
await writeFile('site-dist/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${catalog.baseUrl}/</loc></url></urlset>\n`);
await import('./pack-release.mjs');
await mkdir('site-dist/downloads');
const pkg=JSON.parse(await readFile('package.json','utf8'));
for(const name of [`avatar-atlas-${pkg.version}.tgz`,'avatar-atlas-v1.zip']) await copyFile('.local/releases/'+name,'site-dist/downloads/'+name);
await copyFile('README.md','site-dist/downloads/CLI-README.md');
console.log(`Built ${catalog.items.length} avatars for ${catalog.baseUrl}/`);
