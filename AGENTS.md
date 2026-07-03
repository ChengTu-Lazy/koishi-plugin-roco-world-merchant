# AGENTS.md

## 项目定位

这是 `koishi-plugin-roco-world-merchant`，用于《洛克王国：世界》的 Koishi 插件。

核心能力包括：

- 远行商人定时推送和手动查询。
- 公告/活动推送。
- 家园查询、UID 绑定、蛋和作物提醒。
- 关注物品命中提醒。
- 基于 `puppeteer` 服务生成 PNG 卡片。

## 文档维护

- `readme.md` 面向普通使用者，只保留功能介绍、安装、常用配置、指令和鸣谢。
- 技术实现、数据源策略、缓存细节、发布流程、易踩坑优先写在本文件。
- 文档和源码中文必须使用 UTF-8 保存；在 Windows PowerShell 中读取中文文件时优先使用 `Get-Content -Encoding UTF8`。

## 数据源注意事项

- `arkmeng` 是默认主源，来自洛克万事屋免登录接口。
- `onebiji` 是免 key 页面候补源。
- `magicbook` 是洛克魔法书开放 API 源，需要 `rocomApiKey`。
- `xianyuw` 是咸鱼备用源，需要 `apiKey`。
- 远行商人源顺序由 `preferredSource` 决定，失败后会自动尝试其他可用源。
- 只有所有可用源都失败时，才允许回退到兼容版本的旧缓存。
- 家园查询源由 `homePreferredSource` 决定，当前支持 `arkmeng` 和 `magicbook`。

## 魔法书接口注意事项

- 远行商人接口路径是 `/api/v1/games/rocom/merchant/info`，基础地址默认 `https://wegame.shallow.ink`。
- 魔法书商人源需要传 `random_goods=all` 获取随机商品全集，否则会漏掉炫彩蛋等当前轮随机商品。
- `random_goods=all/full/true/1/yes` 返回的是全部随机商品池，不是当前在售商品；插件必须按东八区 `08:00-12:00`、`12:00-16:00`、`16:00-20:00`、`20:00-24:00` 在本地筛当前轮。
- 当前实现中，魔法书商人源请求 `refresh=false&random_goods=all`，本地强制刷新只绕过插件缓存，不默认触发魔法书服务端强刷。
- 插件本地强制刷新只绕过本地缓存，不会自动追加魔法书服务端 `refresh=true`；如后续要增加服务端强刷，应做成显式配置或独立命令。
- 公告/活动接口属于付费请求相关能力，默认关闭，避免升级后自动产生请求。

## 缓存和刷新

- 远行商人缓存文件位于 `data/roco-world-merchant/cache.json`。
- 家园查询状态位于 `data/roco-world-merchant/home-query.json`。
- 公告/活动状态位于 `data/roco-world-merchant/announcement.json`。
- 家园图片远程素材运行时缓存位于 `data/roco-world-merchant/assets/`，不应进入 npm 包。
- `CACHE_DATA_VERSION` 用于避免旧结构或错误结构缓存继续被复用。
- `IMAGE_RENDER_VERSION` 用于控制卡片图片缓存是否可复用。
- 图片缓存复用前需要比较商品签名，避免同一时间段内商品变化但旧图继续发送。
- 普通手动查询默认优先复用可用缓存。
- 定时推送当前会绕过插件本地缓存重新请求数据源。
- 强制刷新失败时，会尝试所有可用源；仍失败才回退旧缓存。

## 图片渲染

- 本插件依赖 Koishi `puppeteer` 服务，即 `ctx.puppeteer`。
- 不要重新引入 `sharp` 作为 SVG 转 PNG 的默认方案。
- 商人卡片 SVG 由 `src/render/image.ts` 生成，再通过 `src/render/puppeteer.ts` 截图为 PNG。
- 家园卡片 SVG 由 `src/render/home-image.ts` 生成。
- 家园图片中的宠物头像、守护精灵头像、作物图标应优先使用接口字段，缺失时再按名称回退到洛克万事屋资源。

## 源码结构

- `src/index.ts`: Koishi 插件入口、命令注册、定时调度、推送发送。
- `src/schema.ts`: 插件配置 Schema。
- `src/services/merchant-store.ts`: 远行商人缓存、源切换、图片生成。
- `src/services/home-store.ts`: 家园查询、绑定、短缓存。
- `src/services/announcement-store.ts`: 公告/活动推送状态。
- `src/services/asset-cache.ts`: 运行时远程素材缓存。
- `src/sources/arkmeng.ts`: 洛克万事屋商人源。
- `src/sources/magicbook.ts`: 洛克魔法书商人源。
- `src/sources/home.ts`: 家园查询源。
- `src/sources/announcement.ts`: 公告/活动源。
- `src/sources/xianyuw.ts`: 咸鱼备用源。
- `src/sources/onebiji.ts`: onebiji 页面候补源。
- `src/render/*`: 文本、商人图片、家园图片、公告消息渲染。
- `src/utils/*`: 时间、解析、错误、关注物品、家园提醒等工具。

## 配置兼容

- 旧配置 `scheduleHours` 仍可读取，并会按 `HH:00` 转换。
- `platform` 兼容 `onebot` 与旧写法 `qq`。
- `pushTargets.selfId` 可留空；同平台只有一个在线 bot 时会自动选择，否则需要用户配置。
- `pushTargets.guildId` 主要用于部分频道平台，普通 QQ 群通常可留空。

## 验证命令

改动后优先运行：

```powershell
npm run build
npm run verify:pack
git diff --check
```

如果只改 README 或 AGENTS.md，可至少运行：

```powershell
git diff --check
```

## 发布约定

- 用户说“发版”时，本仓库默认理解为提交并推送到 GitHub，由 GitHub Actions 自动发布 npm。
- 不要默认本地执行 `npm publish`。
- 推送前必须基于真实 `git diff`、`git status` 和验证结果整理说明。
- 当前 workflow 是 `.github/workflows/npm-publish.yml`，会构建、校验包内容，并在 npm 版本不存在时发布。

## 工作区安全

- 本仓库经常存在用户或前序任务留下的未提交改动，修改前先看 `git status --short`。
- 不要使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 不要回滚无关改动。
- 手动编辑文件使用 `apply_patch`。
