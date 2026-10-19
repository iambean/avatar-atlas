# Avatar Atlas

80 张头像、6 个分类，支持下载到项目本地，并生成 JS / TS 使用接口。需要 Git 和 Node.js 20 或更新版本。工具没有第三方运行时依赖。

[浏览图库](https://iambean.github.io/avatar-atlas/) · [下载与版本记录](https://github.com/iambean/avatar-atlas/releases)

## 安装工具

从 GitHub 安装固定版本，安装一次后即可在不同项目中使用：

```sh
npm install --global github:iambean/avatar-atlas#v1.3.1
```

也可以在项目目录直接执行一次：

```sh
npx --yes github:iambean/avatar-atlas#v1.3.1 init
```

这两种方式均从 GitHub 获取工具，无需 npm registry 账号。没有 Git 的环境可从 Releases 下载 `.tgz`，再运行 `npm install --global ./avatar-atlas-1.3.1.tgz`。

## 在项目中使用

进入项目目录执行：

```sh
avatar-atlas init
```

工具会安装本地图片、索引和署名，写入 `avatar-atlas.config.json` 与 `avatar-atlas.lock.json`，并生成使用模块：有 `src/` 且有 `tsconfig.json` 时使用 `src/lib/avatar-atlas.ts`；只有 `src/` 时使用 `.js`；其他项目使用根目录 `avatar-atlas.mjs`。

```ts
import { avatarUrl, avatars, findAvatars } from './lib/avatar-atlas';

avatarUrl();                            // 中性默认头像
avatarUrl('portrait-cartoon-01');        // 当前项目的图片地址
findAvatars({ category: 'cartoon', gender: 'female' });
// avatars 是可供选择的头像列表，每项有 id、title、url、category 等字段。
```

导入路径按调用文件的位置调整。React 可使用 `<img src={avatarUrl(user.avatarId)} />`，Vue 可使用 `<img :src="avatarUrl(user.avatarId)" />`。不使用 JS 的项目可直接读取安装目录里的 `manifest.json`。用户资料保存 `id`，不必存储图库域名。

## 按需安装与更新

```sh
avatar-atlas init --categories cartoon,geometry
avatar-atlas add landscapes
avatar-atlas update
avatar-atlas status
avatar-atlas list
```

分类为 `realistic`、`cartoon`、`abstract`、`objects`、`landscapes`、`geometry`。按需安装始终附带中性默认头像 `geometry-02`。`init` 使用工具随附的离线素材；`update` 读取官网最新索引，只下载缺少或变化的图片。运行中的应用始终使用项目本地文件。

```sh
avatar-atlas init --dir public/images/avatars --base-url /images/avatars
avatar-atlas init --dir static/avatars --base-url /static/avatars --module assets/avatars.mjs
avatar-atlas init --cwd ./another-project --json
```

子路径部署或使用自己的 CDN 时，通过 `--base-url` 设置公开前缀。自定义目录必须位于项目内；工具拒绝通过符号链接写入。

## 文件与更新行为

- 把配置文件、lock 文件、生成的模块和图片一起提交到版本控制。
- 重复安装会跳过未变化的文件；`status` 检测缺失和被修改的文件。
- 工具只管理记录在 lock 文件中的文件，保留其他项目文件。
- 有人手动修改托管文件时停止更新；明确使用 `--force` 才恢复图库版本。即使有 `--force`，也不会覆盖未知的同名项目文件。
- 下载和 SHA-256 校验全部完成后才写入；写入失败会回滚已经替换的文件。
- 更新后下架的图片仍保留，已有头像 ID 继续可用。它们标记为 `retired`，不会出现在 `avatars` 和 `findAvatars()` 的新选择列表中。
- 未知头像 ID 会由 `avatarUrl()` 回退到默认头像。
- `update` 更新素材；工具自身升级请重新运行对应版本的 npm 安装命令。

## 授权

CLI 和接口代码采用 MIT；图片采用 CC BY 4.0。工具自动安装 `LICENSE.txt` 和 `ATTRIBUTION.txt`。请将署名放在项目的关于页或素材致谢中，并注明对图片所做的修改。

人物、物品和景色由 AI 辅助生成，仿真人物均为虚构形象；几何素材由代码绘制。创作定义位于 `provenance/`。

## 维护与发布

```sh
npm test
npm run build:site
npm run check
```

仓库包含 CLI、512px WebP、索引、网站源码和创作定义。构建从 `media.json` 指定的 GitHub Release 下载高分辨率媒体，并验证 SHA-256；完整媒体不进入 Git 历史。构建结果在 `site-dist/`。

发布流程、数据来源和兼容规则见 [架构设计](docs/architecture.md)。Pages 由发布 Release 或手动运行 Pages 工作流更新。安装时固定版本，更新素材时读取 Pages 上的最新索引。
