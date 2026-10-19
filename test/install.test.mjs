import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {install, status, sha256, validateCatalog, SOURCE} from '../lib/install.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'avatar-atlas-test-'));
  const project = join(root, 'project'), bundle = join(root, 'bundle');
  await mkdir(project); await mkdir(join(bundle, 'assets'), {recursive: true});
  const images = new Map();
  const items = [['geometry-02','geometry'],['cartoon-01','cartoon'],['realistic-01','realistic']].map(([id, category]) => {
    const bytes = Buffer.from('RIFF....WEBPfixture:' + id); images.set(id, bytes);
    return {id, category, title: id, tags: [category], sha256: sha256(bytes), license:'CC-BY-4.0', formats:{webp:`/avatars/v1/${id}.webp`}};
  });
  const catalog = {version:'1.0.0', defaultAvatarId:'geometry-02', attribution:'Avatar Atlas · CC BY 4.0', categories:items.map(a=>({id:a.category,name:a.category})), items};
  for (const [id, bytes] of images) await writeFile(join(bundle, 'assets', id + '.webp'), bytes);
  await writeFile(join(bundle, 'catalog.json'), JSON.stringify(catalog)); await writeFile(join(bundle, 'ASSET-LICENSE.txt'), 'CC BY 4.0');
  t.after(()=>rm(root,{recursive:true,force:true}));
  return {root, project, bundle, catalog, images};
}

async function server(t, catalog, images) {
  const app = createServer((req,res)=>{ if(req.url==='/manifest.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(catalog));return;}const id=req.url.split('/').at(-1).replace('.webp','');const bytes=images.get(id);res.statusCode=bytes?200:404;res.end(bytes||'missing'); });
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}/manifest.json`;
}

test('offline init generates a working API; repeated init is idempotent',async t=>{
  const f=await fixture(t);const options={dir:'public/team/avatars',baseUrl:'/team/avatars'};
  const first=await install({cwd:f.project,bundleRoot:f.bundle,options});assert.equal(first.active,3);assert.equal(first.downloaded,0);
  const api=await import(pathToFileURL(join(f.project,'avatar-atlas.mjs')));assert.equal(api.avatarUrl('cartoon-01'),'/team/avatars/v1/cartoon-01.webp');assert.equal(api.avatarUrl('unknown'),'/team/avatars/v1/geometry-02.webp');assert.equal(api.findAvatars({category:'cartoon'}).length,1);
  assert.equal((await install({cwd:f.project,bundleRoot:f.bundle})).changed,0);assert.equal((await status(f.project)).ok,true);
});

test('category selection includes default; add extends it and keeps unrelated files',async t=>{
  const f=await fixture(t);await mkdir(join(f.project,'public'),{recursive:true});await writeFile(join(f.project,'public','keep.txt'),'own content');
  const first=await install({cwd:f.project,bundleRoot:f.bundle,options:{categories:['cartoon']}});assert.equal(first.active,2);
  const next=await install({cwd:f.project,bundleRoot:f.bundle,command:'add',options:{categories:['realistic']}});assert.equal(next.active,3);assert.equal(await readFile(join(f.project,'public','keep.txt'),'utf8'),'own content');
});

test('bad remote checksum does not change any installed files',async t=>{
  const f=await fixture(t);await install({cwd:f.project,bundleRoot:f.bundle});const before=await readFile(join(f.project,'avatar-atlas.lock.json'));
  f.catalog.items[1].sha256='a'.repeat(64);const source=await server(t,f.catalog,f.images);
  await assert.rejects(install({cwd:f.project,bundleRoot:f.bundle,command:'update',options:{source}}),/校验失败/);
  assert.deepEqual(await readFile(join(f.project,'avatar-atlas.lock.json')),before);assert.equal((await status(f.project)).ok,true);
});

test('remote updates fetch changed files and retain removed IDs for existing users',async t=>{
  const f=await fixture(t);await install({cwd:f.project,bundleRoot:f.bundle});
  const changed=Buffer.from('RIFF....WEBPchanged version');f.images.set('cartoon-01',changed);f.catalog.items[1].sha256=sha256(changed);f.catalog.items=f.catalog.items.filter(a=>a.category!=='realistic');f.catalog.version='1.1.0';
  const source=await server(t,f.catalog,f.images);const result=await install({cwd:f.project,bundleRoot:f.bundle,command:'update',options:{source}});
  assert.equal(result.downloaded,1);assert.equal(result.retained,1);assert.deepEqual(await readFile(join(f.project,'public/avatars/v1/cartoon-01.webp')),changed);
  const api=await import(pathToFileURL(join(f.project,'avatar-atlas.mjs')));assert.equal(api.avatars.length,2);assert.equal(api.getAvatar('realistic-01').retired,true);assert.equal(api.avatarUrl('realistic-01'),'/avatars/v1/realistic-01.webp');
  const repeated=await install({cwd:f.project,bundleRoot:f.bundle});assert.equal(repeated.version,'1.1.0');assert.equal(repeated.changed,0);
});

test('modified managed files require force; unknown files are never overwritten',async t=>{
  const f=await fixture(t);await install({cwd:f.project,bundleRoot:f.bundle});const file=join(f.project,'public/avatars/v1/cartoon-01.webp');await writeFile(file,'hand edited');
  await assert.rejects(install({cwd:f.project,bundleRoot:f.bundle}),/已修改/);assert.equal(await readFile(file,'utf8'),'hand edited');
  await install({cwd:f.project,bundleRoot:f.bundle,options:{force:true}});assert.equal((await status(f.project)).ok,true);
  const other=join(f.root,'other');await mkdir(join(other,'public/avatars/v1'),{recursive:true});await writeFile(join(other,'public/avatars/v1/geometry-02.webp'),'unmanaged');
  await assert.rejects(install({cwd:other,bundleRoot:f.bundle,options:{force:true}}),/已有其他文件/);assert.equal(await readFile(join(other,'public/avatars/v1/geometry-02.webp'),'utf8'),'unmanaged');
});

test('path traversal, symlinks and unknown categories fail before writes',async t=>{
  const f=await fixture(t);
  await assert.rejects(install({cwd:f.project,bundleRoot:f.bundle,options:{dir:'../outside',baseUrl:'/outside'}}),/不允许此路径/);
  await symlink(f.bundle,join(f.project,'public'));
  await assert.rejects(install({cwd:f.project,bundleRoot:f.bundle}),/符号链接/);await rm(join(f.project,'public'));
  await assert.rejects(install({cwd:f.project,bundleRoot:f.bundle,options:{categories:['missing']}}),/未知分类/);
  assert.deepEqual(await readdir(f.project),[]);
});

test('TypeScript projects receive a typed self-contained module',async t=>{
  const f=await fixture(t);await mkdir(join(f.project,'src'));await writeFile(join(f.project,'tsconfig.json'),'{}');
  const r=await install({cwd:f.project,bundleRoot:f.bundle});assert.equal(r.modulePath,'src/lib/avatar-atlas.ts');const text=await readFile(join(f.project,r.modulePath),'utf8');assert.match(text,/export type AvatarId/);assert.match(text,/export function avatarUrl\(id: string/);
});

test('malformed catalogs and concurrent install guards are rejected',async t=>{
  const f=await fixture(t);const broken=structuredClone(f.catalog);broken.items[0].formats.webp='/../../secret';assert.throws(()=>validateCatalog(broken),/素材条目无效/);
  await writeFile(join(f.project,'.avatar-atlas.installing'),'other task');await assert.rejects(install({cwd:f.project,bundleRoot:f.bundle}),/已有安装任务/);
});

test('root public paths remain stable and changed directories infer new URLs',async t=>{
  const f=await fixture(t);await install({cwd:f.project,bundleRoot:f.bundle,options:{baseUrl:'/'}});
  assert.equal((await install({cwd:f.project,bundleRoot:f.bundle})).changed,0);
  const first=await import(pathToFileURL(join(f.project,'avatar-atlas.mjs')));assert.equal(first.avatarUrl(),'/v1/geometry-02.webp');
  const moved=await install({cwd:f.project,bundleRoot:f.bundle,options:{dir:'public/team/avatars'}});assert.equal(moved.baseUrl,'/team/avatars');assert.equal((await status(f.project)).ok,true);
});

test('Pages project subpaths download changed images and preserve local URLs',async t=>{
  const f=await fixture(t);await install({cwd:f.project,bundleRoot:f.bundle});
  const changed=Buffer.from('RIFF....WEBPsubpath change');
  f.catalog.baseUrl='https://example.org/avatar-atlas';
  f.catalog.version='1.1.0';
  for(const item of f.catalog.items) item.formats.webp='/avatar-atlas'+item.formats.webp;
  f.catalog.items[1].sha256=sha256(changed);
  const requests=[];
  const fetcher=async url=>{
    requests.push(new URL(url).pathname);
    if(new URL(url).pathname==='/avatar-atlas/manifest.json') return new Response(JSON.stringify(f.catalog));
    if(new URL(url).pathname==='/avatar-atlas/avatars/v1/cartoon-01.webp') return new Response(changed);
    return new Response('missing',{status:404});
  };
  const result=await install({cwd:f.project,bundleRoot:f.bundle,command:'update',options:{source:'https://example.org/avatar-atlas/manifest.json'},fetcher});
  assert.equal(result.downloaded,1);
  assert.deepEqual(requests,['/avatar-atlas/manifest.json','/avatar-atlas/avatars/v1/cartoon-01.webp']);
  const api=await import(pathToFileURL(join(f.project,'avatar-atlas.mjs')));
  assert.equal(api.avatarUrl('cartoon-01'),'/avatars/v1/cartoon-01.webp');
  f.catalog.items[0].formats.webp='/other/avatars/v1/geometry-02.webp';
  assert.throws(()=>validateCatalog(f.catalog),/素材条目无效/);
});

test('old official source migrates, custom sources and explicit overrides survive',async t=>{
  const f=await fixture(t);await install({cwd:f.project,bundleRoot:f.bundle});
  const path=join(f.project,'avatar-atlas.config.json');
  const config=JSON.parse(await readFile(path,'utf8'));
  config.source='https://avatar-atlas-studio.niftybay4.chatgpt.site/manifest.json';
  await writeFile(path,JSON.stringify(config));
  const requested=[];
  const fetcher=async url=>{requested.push(String(url));return new Response(JSON.stringify(f.catalog));};
  await install({cwd:f.project,bundleRoot:f.bundle,command:'update',fetcher});
  assert.equal(requested.at(-1),SOURCE);assert.equal((await status(f.project)).source,SOURCE);
  config.source='https://example.org/custom.json';await writeFile(path,JSON.stringify(config));
  await install({cwd:f.project,bundleRoot:f.bundle,command:'update',fetcher});
  assert.equal(requested.at(-1),config.source);
  const override='https://example.org/explicit.json';
  await install({cwd:f.project,bundleRoot:f.bundle,command:'update',options:{source:override},fetcher});
  assert.equal(requested.at(-1),override);assert.equal((await status(f.project)).source,override);
});
