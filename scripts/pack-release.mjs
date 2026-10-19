import {readFile, writeFile, mkdir, copyFile, rm, readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out = '.local/releases', bundle = '.local/asset-bundle';
await mkdir(out, {recursive:true});
await rm(bundle, {recursive:true, force:true});
await mkdir(bundle+'/avatars/v1', {recursive:true});
const catalog = JSON.parse(await readFile('catalog.json','utf8'));
const offline = {...catalog, baseUrl:'', bundleFormats:['webp','svg'], items:catalog.items.map(a=>({...a, formats:{webp:`/avatars/v1/${a.id}.webp`,...(a.formats.svg?{svg:`/avatars/v1/${a.id}.svg`}:{})},sizes:{webp:512}}))};
for(const asset of catalog.items){
  await copyFile(`assets/${asset.id}.webp`,`${bundle}/avatars/v1/${asset.id}.webp`);
  if(asset.formats.svg) await copyFile(`.local/media/avatars/v1/${asset.id}.svg`,`${bundle}/avatars/v1/${asset.id}.svg`);
}
await writeFile(bundle+'/manifest.json',JSON.stringify(offline,null,2)+'\n');
await copyFile('ASSET-LICENSE.txt',bundle+'/LICENSE.txt');
await writeFile(bundle+'/ATTRIBUTION.txt',catalog.attribution+'\n如有修改，请注明。\n');
await writeFile(bundle+'/README.txt','包含全部 80 张 512px WebP 与 10 张几何 SVG。复制 avatars/ 到项目静态目录，读取 manifest.json 选图。1024px PNG 可在图库单张下载。\n'+catalog.attribution+'\n');
const archive = resolve(out+'/avatar-atlas-v1.zip');
await rm(archive,{force:true});
execFileSync('zip',['-qr',archive,'.'],{cwd:bundle});
const packed = JSON.parse(execFileSync('npm',['pack','--pack-destination',out,'--json','--ignore-scripts'],{encoding:'utf8'}))[0];
const lines=[];
for(const name of (await readdir(out)).filter(x=>/\.(zip|tgz)$/.test(x)).sort()) lines.push(createHash('sha256').update(await readFile(out+'/'+name)).digest('hex')+'  '+name);
await writeFile(out+'/SHA256SUMS',lines.join('\n')+'\n');
console.log(JSON.stringify({package:packed.filename,bytes:packed.size,avatars:catalog.items.length}));
