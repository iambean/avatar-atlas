#!/usr/bin/env node
import {install, status, bundledCatalog, TOOL_VERSION} from '../lib/install.mjs';

const help = `Avatar Atlas ${TOOL_VERSION} · 本地头像工具

用法：
  avatar-atlas init                         安装全部头像并生成使用接口
  avatar-atlas init --categories cartoon,geometry
  avatar-atlas init --dir public/images/avatars --base-url /images/avatars
  avatar-atlas add landscapes              追加分类
  avatar-atlas update                      检查公网最新索引，增量更新
  avatar-atlas status                      检查安装状态与文件完整性
  avatar-atlas list                        查看可用分类

选项：
  --cwd <项目目录>                         默认当前目录
  --dir <相对目录>                         默认 public/avatars
  --base-url <公开路径>                    默认 /avatars
  --module <相对路径>                      自动选择 src/lib/avatar-atlas.ts、.js 或根目录 .mjs
  --categories <分类,分类>                 默认 all；始终包含中性默认头像
  --source <HTTPS 索引地址>                指定素材源
  --force                                 恢复被修改的图库托管文件
  --json                                  输出 JSON，适合自动化脚本
  --version                               输出工具版本

无需账号、API Key 或特定 AI 工具。安装后运行时仅使用项目本地文件。`;

try {
  const args = process.argv.slice(2).flatMap(arg => arg.startsWith('--') && arg.includes('=') ? [arg.slice(0,arg.indexOf('=')),arg.slice(arg.indexOf('=')+1)] : [arg]);
  if (args.includes('--version')) { console.log(TOOL_VERSION); process.exit(0); }
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(help); process.exit(0); }
  const command = args.shift(); const options = {}; let cwd = process.cwd(); let asJson = false;
  if (!['init', 'add', 'update', 'status', 'list'].includes(command)) throw Error('未知命令：' + command + '。运行 avatar-atlas --help 查看用法。');
  if (command === 'add' && args[0] && !args[0].startsWith('-')) options.categories = args.shift().split(',').filter(Boolean);
  const fields = {'--dir':'dir', '--base-url':'baseUrl', '--module':'module', '--categories':'categories', '--source':'source'};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--force') { options.force = true; continue; }
    if (flag === '--json') { asJson = true; continue; }
    if (flag !== '--cwd' && !fields[flag]) throw Error('未知选项：' + flag);
    const value = args.shift(); if (!value || value.startsWith('--')) throw Error('选项缺少值：' + flag);
    if (flag === '--cwd') cwd = value;
    else options[fields[flag]] = flag === '--categories' ? value.split(',').map(x => x.trim()).filter(Boolean) : value;
  }
  if (command === 'add' && !options.categories?.length) throw Error('请指定追加分类，例如 avatar-atlas add landscapes。');
  let result;
  if (command === 'list') {
    const data = await bundledCatalog(); result = data.categories.map(c => ({...c, count: data.items.filter(a => a.category === c.id).length}));
    console.log(asJson ? JSON.stringify(result) : result.map(c => `${c.id.padEnd(12)} ${c.name} · ${c.count}`).join('\n'));
  } else if (command === 'status') {
    result = await status(cwd); console.log(asJson ? JSON.stringify(result) : `${result.ok ? '✓ 文件完整' : '发现文件变化'} · 素材 ${result.version}\n目录：${result.assetsDir}\n模块：${result.modulePath}${result.differences.length ? '\n'+result.differences.map(x => `${x.status}: ${x.path}`).join('\n') : ''}`);
    if (!result.ok) process.exitCode = 1;
  } else {
    result = await install({cwd, command, options});
    console.log(asJson ? JSON.stringify(result) : `✓ ${result.changed ? '安装完成' : '已是最新'} · ${result.active} 张头像${result.retained ? `，保留 ${result.retained} 张旧头像引用` : ''}\n素材版本：${result.version}\n图片目录：${result.assetsDir}\n使用接口：${result.modulePath}\n配置文件：avatar-atlas.config.json\n\n使用 avatarUrl('portrait-cartoon-01') 获取地址，avatars 获取可选列表。`);
  }
} catch (error) { console.error('Avatar Atlas: ' + error.message); process.exitCode = 1; }
