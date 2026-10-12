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
- 公告展示调用 `/api/v1/games/rocom/announcement/list?page=1&limit=10`，保留接口顺序（包含置顶），失败回退 latest；列表不代表当天全部公告。详情请求继续受 detailLimit 限制。
- `公告素材 [id]` 单独请求 detail 提取原图、视频、正文链接；省略 id 时先调用 latest。返回 URL 列表，不自动下载大视频。卡片预览图与素材原图分别处理。
- 公告详情接口 `/api/v1/games/rocom/announcement/detail` 会按公告条数额外产生请求，用于补全详情正文和图片；定时推送只在 `announcementPush.fetchDetails` 开启时调用，手动 `公告活动推送` 默认调用，均受 `detailLimit` 限制。
- 公告/活动输出会过滤已过期活动；结束时间距当前小于等于 48 小时的活动视为临期活动，需要置顶并在图片卡片中红色加粗展示。

## 缓存和刷新

- 查蛋指令为 `查蛋 [...args:string]`，独立于家园查询开关，不要求 UID。身高输入为米、体重为千克；本地数据内部为厘米、克。
- 双尺寸反查优先免 key 请求 BWIKI 工具站 `https://roco.gptvip.chat/api/magic-egg-lookup?height_m=...&weight_kg=...`，只传尺寸，不默认指定蛋种。失败后按魔法书 `/egg/search` → `/wiki/pet-size/query`（需 `rocomApiKey`）→ 内置快照回退；成功空结果不回退。备用结果标明主源不可用及数据可能不完整。名称查询使用 `/egg/pet-groups`、`/egg/group-pets`，失败回退本地。单尺寸查询使用本地数据，不请求付费接口。
- BWIKI 返回的 `match_probability` 为参考概率，`fit_score` 为尺寸匹配度，`confidence_text` 为置信度，三者不得混用。卡片分别展示；接口没有提供尺寸区间时，不使用旧快照补造区间。`scripts/fixtures/bwiki-egg-027-3151.json` 为未指定蛋种的实测响应摘录，含用户提供的13只及诅咒狼灵，共14只；它不等同于同乘蛋池的13只结果。
- 内置查蛋数据位于 `src/data/egg-data.ts`，来源提交及许可见 `THIRD-PARTY-NOTICES.md`、`LICENSE.egg-data`；构建时打入 JS，无运行时远程下载。本地尺寸匹配度为区间符合程度（范围外15%容差），不是归一化孵出概率。
- 精灵家族（进化链）数据位于 `src/data/egg-families.ts`，由 `scripts/build-egg-families.cjs` 从上游 `Pets.json` 的 `evolves_from_id` 生成（`node scripts/build-egg-families.cjs [Pets.json 路径]`，省略路径时按固定提交下载）；键为精灵 ID，值为同家族最低阶精灵 ID，仅收录存在进化前身的精灵。上游存在变体互相进化的环，生成时取环上最小 ID。
- 名称查询默认折叠同家族进化形态，只展示各家族最低阶精灵：本地路径先按家族过滤再按名称去重，避免重名变体挤掉最低阶；魔法书 `/egg/group-pets` 路径按 ID 过滤，ID 对不上内置数据时才退回名称判断，且只对“从不属于最低阶”的名称生效。查询进化形态时会额外提示家族最低阶（`EggCard.familyBase`）。尺寸反查不折叠家族，BWIKI 源本身只返回可孵化的最低阶。
- 魔法书名称接口 `/egg/pet-groups` 返回的 `height_range_m`/`height_range_cm`/`weight_range_kg`/`weight_range_g` 是精灵体型范围，不是孵化尺寸：实测 `火花` 返回 0.17–0.53m / 7.6–8.5kg，而蛋尺寸为 0.23–0.29m / 2.66–3.4kg。因此名称查询的蛋尺寸只认接口显式 `egg_size`，其余情况一律回退内置快照（并按 ID、旧编号 +3000、名称依次匹配），无法匹配时显示暂无数据，绝不把体型当蛋尺寸；回退时结果标注“蛋尺寸来自内置快照”。`/egg/search`、`/wiki/pet-size/query` 的尺寸反查仍按原顺序读取（`egg_size` → `height_range_m` → `height_range_cm`/`diameterMin`），该路径的区间语义尚未实测确认。
- `src/services/egg-query.ts` 实现输入解析和数据源回退；`src/render/egg.ts` 生成分页 SVG，复用 Puppeteer 和 outputMode，渲染失败回退文字。
- 查蛋结果使用结构化 `EggCard`、`EggSection` 渲染双列卡片，每页最多8只；顶部突出输入尺寸，候选显示图标、匹配度和尺寸区间，名称查询显示精灵档案。图标优先使用接口 URL，缺失时按精灵 ID 构造官方图标；发送前经 AssetCache 内联为 data URI，失败时保留文字占位。
- 精灵图标只对 `3000-3999` 正式编号使用 `game.gtimg.cn/.../jingling/<id>/icon.png`：实测 4xxx、5xxx、8xxx、10xxxx、1300xxxx、1800xxxx 等编号全部 404（如 `嘟嘟煲#18000004`、`恶魔狼#103012`），这些编号改用按名称的 arkmeng 资源，两者都取不到时显示首字占位。正式编号里也有少数未实装精灵（如 3217-3219、3408、3621/3622、3720-3728）没有图标，同样走首字占位。
- `AssetCache.inlineSvgImages` 会在素材取不到时删除对应的 `<image>` 标签，让卡片底层绘制的首字占位显示出来；否则 SVG 里会留下 404 的远程地址，Puppeteer 截图时画出浏览器的破图图标（2026-02 用户反馈的 `查蛋 阿米亚特` 卡片缺图即此原因）。
- 内置快照同一名称可能有多条记录（活动/首领/特殊编号），名称查询与候选列表按“有蛋组 + 正式编号”优先取一条，避免命中蛋组为空、图标 404 的重复记录（如 `嘟嘟煲` 取 #3367 而非 #18000004，`恶魔狼` 取 #3011 而非 #103012）；并列时保持原有的后者优先行为。

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

- `announcementPush.recentDays` 默认 3，0 不限；按插件时区的自然日（包含今天）筛选公告，使用 publishedAt 或 time，排除缺失时间及未来时间。筛选在详情请求前执行，不增加列表分页请求，仍只覆盖首页最多 10 条；活动与素材查询不受影响。

- 公告按 4400 逻辑像素高度自动分页，优先在卡片之间分隔；超长单条按文字行和图片行分段，续段重复标题时间，保留全部正文、图片及末尾素材指令。截图倍率为 2，输出图片高度上限通常为 8800 像素。
- 多页时，尾页最终输出高度低于 4400 像素（2200 逻辑像素，包含页眉页脚）则合并到前一页；合并后允许超过通常上限。仅一页时不合并，合并后重新计算页码。

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
- `pushTargets.guildId` 仅作为旧配置兼容字段保留，不再暴露到普通配置界面。
- `primarySourceUrl`、`apiBaseUrl`、`rocomApiBaseUrl`、`refreshValue`、命令名/别名、时区、超时、启动补推窗口等高级项不再暴露到 Koishi 配置界面；运行时由 `resolveConfigDefaults()` 补默认值，并继续兼容旧数据库配置。

## 验证命令

改动后优先运行：

```powershell
npm run build
npm run verify:pack
git diff --check
```

查蛋功能改动还需运行 `node scripts/test-egg-query.cjs`，覆盖解析、内置数据、接口回退及分页；测试不请求线上付费 API。

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
