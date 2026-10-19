import {readFile, writeFile, mkdir, lstat, realpath, mkdtemp, rename, rm, open} from 'node:fs/promises';
import {resolve, relative, dirname, join, isAbsolute, win32} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runtimeModule, runtimeTypes} from './runtime.mjs';

export const TOOL_VERSION = '1.3.0';
export const SOURCE = 'https://iambean.github.io/avatar-atlas/manifest.json';
const LEGACY_SOURCE = 'https://avatar-atlas-studio.niftybay4.chatgpt.site/manifest.json';
const CONFIG = 'avatar-atlas.config.json';
const LOCK = 'avatar-atlas.lock.json';
const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function exists(path) { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

export async function safePath(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || isAbsolute(name) || win32.isAbsolute(name)) throw Error('目录必须是项目内的相对路径。');
  const parts = name.replaceAll('\\', '/').split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p === '.git' || p === 'node_modules')) throw Error('不允许此路径：' + name);
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw Error('目标路径不能经过符号链接：' + name); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return cursor;
}

function sourceURL(value) {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('素材源须使用 HTTPS（本机测试可使用 HTTP）。');
  return url;
}

function publicPath(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !value || /[?#\\\s]/.test(value)) throw Error('base-url 必须是以 / 开头的路径或 HTTPS 地址。');
  if (value.startsWith('/') && !value.startsWith('//')) return value.replace(/\/+$/, '');
  return sourceURL(value).href.replace(/\/+$/, '');
}

export function validateCatalog(catalog) {
  if (!catalog || typeof catalog.version !== 'string' || !Array.isArray(catalog.items) || !catalog.items.length || catalog.items.length > 5000 || !Array.isArray(catalog.categories)) throw Error('素材索引格式无效。');
  const prefix = catalog.baseUrl ? sourceURL(catalog.baseUrl).pathname.replace(/\/$/, '') : '';
  const seen = new Set();
  const categories = new Set(catalog.categories.map(c => c.id));
  for (const item of catalog.items) {
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(item.id) || seen.has(item.id) || !categories.has(item.category) || !/^[a-f0-9]{64}$/.test(item.sha256) || item.formats?.webp !== `${prefix}/avatars/v1/${item.id}.webp` || typeof item.title !== 'string' || !Array.isArray(item.tags) || !item.tags.every(t => typeof t === 'string') || item.license !== 'CC-BY-4.0') throw Error('素材条目无效：' + (item.id || 'unknown'));
    seen.add(item.id);
  }
  if (!seen.has(catalog.defaultAvatarId)) throw Error('索引缺少默认头像。');
  return catalog;
}

async function fetchBytes(url, limit, fetcher) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, {headers: {'User-Agent': `avatar-atlas-cli/${TOOL_VERSION}`}, signal: AbortSignal.timeout(30000)});
      if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
      if (Number(response.headers.get('content-length')) > limit) throw Error('下载文件超过大小限制。');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.byteLength; if (length > limit) throw Error('下载文件超过大小限制。'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    } catch (e) { last = e; }
  }
  throw Error('下载失败，尚未修改项目文件：' + last.message);
}

function verifyImage(bytes, item) {
  if (sha256(bytes) !== item.sha256 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw Error('头像校验失败：' + item.id);
}

function normalizeManifest(catalog, items, base) {
  return {...catalog, baseUrl: base, categories: catalog.categories.filter(c => items.some(a => a.category === c.id)), items: items.map(item => ({...item, url: `${base}/v1/${item.id}.webp`, formats: {webp: `${base}/v1/${item.id}.webp`}, sizes: {webp: 512}}))};
}

async function loadState(root) {
  const configPath = await safePath(root, CONFIG), lockPath = await safePath(root, LOCK);
  const config = await exists(configPath) ? await readJson(configPath) : null;
  const lock = await exists(lockPath) ? await readJson(lockPath) : null;
  if (config && (config.schemaVersion !== 1 || !Array.isArray(config.categories))) throw Error('已有配置文件格式不兼容。');
  if (lock && (lock.schemaVersion !== 1 || !lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files))) throw Error('已有 lock 文件格式不兼容。');
  if (!!config !== !!lock) throw Error('配置与 lock 文件必须一起保留；请从版本控制恢复缺失文件。');
  return {config, lock};
}

async function verifyManaged(root, lock, force) {
  const results = [];
  for (const [name, hash] of Object.entries(lock?.files || {})) {
    const path = await safePath(root, name);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('lock 校验和无效。');
    if (!await exists(path)) results.push({path: name, status: 'missing'});
    else if (sha256(await readFile(path)) !== hash) results.push({path: name, status: 'modified'});
  }
  const modified = results.filter(x => x.status === 'modified');
  if (modified.length && !force) throw Error('发现已修改的托管文件，未覆盖：\n' + modified.map(x => x.path).join('\n') + '\n如需恢复图库版本，明确使用 --force。');
  return results;
}

async function commitFiles(root, files, lock, force) {
  const changed = [];
  for (const [name, bytes] of files) {
    const target = await safePath(root, name);
    if (await exists(target)) {
      const current = await readFile(target);
      if (current.equals(bytes)) continue;
      if (![CONFIG, LOCK].includes(name) && !lock?.files[name]) throw Error('目标位置已有其他文件，未覆盖：' + name);
      if (lock?.files[name] && sha256(current) !== lock.files[name] && !force) throw Error('文件在安装过程中发生变化，未覆盖：' + name);
    }
    changed.push({name, bytes, target});
  }
  if (!changed.length) return 0;
  const stage = await mkdtemp(join(root, '.avatar-atlas-stage-'));
  const applied = []; let preserveStage = false;
  try {
    for (let i = 0; i < changed.length; i++) await writeFile(join(stage, String(i)), changed[i].bytes);
    for (let i = 0; i < changed.length; i++) {
      const entry = changed[i]; await safePath(root, entry.name); await mkdir(dirname(entry.target), {recursive: true});
      const backup = join(stage, `backup-${i}`); const hadFile = await exists(entry.target);
      if (hadFile) await rename(entry.target, backup);
      applied.push({...entry, backup, hadFile});
      await rename(join(stage, String(i)), entry.target);
    }
  } catch (e) {
    const failures = [];
    for (const entry of applied.reverse()) { try { await rm(entry.target, {force: true}); if (entry.hadFile) await rename(entry.backup, entry.target); } catch (failure) { failures.push(failure.message); } }
    if (failures.length) { preserveStage = true; throw Error('写入失败，部分文件无法回滚；备份保留于 ' + stage + '：' + failures.join('; ')); }
    throw e;
  } finally { if (!preserveStage) await rm(stage, {recursive: true, force: true}); }
  return changed.length;
}

export async function install({cwd = process.cwd(), command = 'init', options = {}, bundleRoot = PACKAGE, fetcher = fetch} = {}) {
  const root = await realpath(cwd);
  const guardPath = await safePath(root, '.avatar-atlas.installing');
  let guard;
  try { guard = await open(guardPath, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw Error('本项目已有安装任务。若上次任务被中断，请确认无任务运行后删除 .avatar-atlas.installing 再重试。'); throw e; }
  try {
    await guard.writeFile(String(process.pid));
    const {config: previous, lock} = await loadState(root);
    if (command !== 'init' && !previous) throw Error('请先运行 avatar-atlas init。');
    await verifyManaged(root, lock, !!options.force);
    const bundled = validateCatalog(await readJson(join(bundleRoot, 'catalog.json')));
    const savedSource = previous?.source === LEGACY_SOURCE ? SOURCE : previous?.source;
    const source = sourceURL(options.source || savedSource || SOURCE);
    const catalog = command === 'update' || options.source || (lock && lock.catalogVersion !== bundled.version) ? validateCatalog(JSON.parse((await fetchBytes(source, 4 * 1024 * 1024, fetcher)).toString())) : bundled;
    const assetsDir = (options.dir || previous?.assetsDir || 'public/avatars').replaceAll('\\', '/');
    const defaultModule = await exists(join(root, 'src')) ? (await exists(join(root, 'tsconfig.json')) ? 'src/lib/avatar-atlas.ts' : 'src/lib/avatar-atlas.js') : 'avatar-atlas.mjs';
    const modulePath = (options.module || previous?.modulePath || defaultModule).replaceAll('\\', '/');
    if (!/\.(?:mjs|js|ts)$/.test(modulePath)) throw Error('module 路径须以 .mjs、.js 或 .ts 结尾。');
    const inferredBase = assetsDir.replaceAll('\\', '/').startsWith('public/') ? '/' + assetsDir.replaceAll('\\', '/').slice(7) : null;
    const base = publicPath(options.baseUrl ?? (options.dir ? inferredBase : previous?.baseUrl) ?? inferredBase ?? (() => {throw Error('自定义静态目录请同时提供 --base-url，例如 /static/avatars。');})());
    await safePath(root, assetsDir); await safePath(root, modulePath);
    let categories = options.categories || previous?.categories || ['all'];
    if (command === 'add') categories = previous.categories.includes('all') ? ['all'] : [...new Set([...previous.categories, ...(options.categories || [])])];
    const known = new Set(catalog.categories.map(c => c.id));
    if (!categories.length || categories.some(c => c !== 'all' && !known.has(c))) throw Error('未知分类；可选：' + [...known].join(', '));
    const active = catalog.items.filter(a => categories.includes('all') || categories.includes(a.category) || a.id === catalog.defaultAvatarId).map(a => ({...a, retired: false}));
    const files = new Map(); let downloaded = 0;
    const selected = [...active];
    if (previous) {
      let old;
      try { old = await readJson(await safePath(root, previous.assetsDir + '/manifest.json')); }
      catch (error) { if (!options.force) throw error; old = {items: []}; }
      if (!Array.isArray(old.items)) throw Error('已安装的素材索引格式无效。');
      for (const item of old.items) if (!active.some(a => a.id === item.id)) selected.push({...item, retired: true});
    }
    let cursor = 0;
    const transfers = await Promise.allSettled(Array.from({length: Math.min(4, selected.length)}, async () => {
      while (cursor < selected.length) {
        const item = selected[cursor++]; const file = assetsDir + '/v1/' + item.id + '.webp';
        const current = await safePath(root, (previous?.assetsDir || assetsDir) + '/v1/' + item.id + '.webp');
        let bytes;
        if (await exists(current)) { const value = await readFile(current); if (sha256(value) === item.sha256) bytes = value; }
        if (!bytes && bundled.items.some(a => a.id === item.id && a.sha256 === item.sha256)) bytes = await readFile(join(bundleRoot, 'assets', item.id + '.webp'));
        if (!bytes) {
          if (item.retired) throw Error('需保留的旧头像缺失，请从版本控制恢复：' + item.id);
          bytes = await fetchBytes(new URL(item.formats.webp, source.origin), 2 * 1024 * 1024, fetcher); downloaded++;
        }
        verifyImage(bytes, item); files.set(file, bytes);
      }
    }));
    const failed = transfers.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const manifest = normalizeManifest(catalog, selected, base);
    const license = await readFile(join(bundleRoot, 'ASSET-LICENSE.txt'));
    files.set(assetsDir + '/manifest.json', json(manifest));
    files.set(assetsDir + '/LICENSE.txt', license);
    files.set(assetsDir + '/ATTRIBUTION.txt', Buffer.from(catalog.attribution + '\n授权：https://creativecommons.org/licenses/by/4.0/\n如有修改，请注明。\n'));
    files.set(modulePath, Buffer.from(runtimeModule(manifest, modulePath.endsWith('.ts'))));
    if (!modulePath.endsWith('.ts')) files.set(modulePath.replace(/\.(mjs|js)$/, (_, ext) => ext === 'mjs' ? '.d.mts' : '.d.ts'), Buffer.from(runtimeTypes(manifest)));
    const nextConfig = {schemaVersion: 1, assetsDir, baseUrl: base, modulePath, categories, source: source.href};
    const hashes = {...(lock?.files || {}), ...Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)]))};
    files.set(CONFIG, json(nextConfig));
    files.set(LOCK, json({schemaVersion: 1, toolVersion: TOOL_VERSION, catalogVersion: catalog.version, files: hashes}));
    const changed = await commitFiles(root, files, lock, !!options.force);
    return {version: catalog.version, active: active.length, retained: selected.length - active.length, downloaded, changed, assetsDir, modulePath, baseUrl: base};
  } finally { await guard.close(); await rm(guardPath, {force: true}); }
}

export async function status(cwd = process.cwd()) {
  const root = await realpath(cwd); const {config, lock} = await loadState(root);
  if (!config) throw Error('尚未安装，运行 avatar-atlas init。');
  const differences = await verifyManaged(root, lock, true);
  return {version: lock.catalogVersion, ...config, differences, ok: differences.length === 0};
}

export async function bundledCatalog(bundleRoot = PACKAGE) { return validateCatalog(await readJson(join(bundleRoot, 'catalog.json'))); }
