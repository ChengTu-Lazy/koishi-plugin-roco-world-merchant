# koishi-plugin-roco-world-merchant

[![npm](https://img.shields.io/npm/v/koishi-plugin-roco-world-merchant?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-roco-world-merchant)
用于获取《洛克王国：世界》远行商人数据，并可选通过洛克万事屋查询玩家家园信息的 Koishi 插件。

数据源策略：

- 默认主数据源：`arkmeng` 洛克万事屋免登录接口
- `onebiji` 免 key 页面作为自动回退候补源
- 支持通过 `preferredSource` 手动切换默认数据源到 `arkmeng`、`onebiji` 或 `xianyuw`
- 备用数据源：咸鱼 API
- 主源请求失败后，会自动切换到其他可用源
- 只有所有可用数据源都失败时，才会回退到旧缓存
- 开启 `homeQueryEnabled` 后，家园查询会使用洛克万事屋的 `ingameQuery` 接口，按 UID 查询玩家家园数据

## 功能

- 支持每天按分钟精度主动推送到配置的群或频道
- 支持命令主动获取
- 支持独立的强制刷新命令
- 可选启用 `查家园 [UID]` 查询家园等级、舒适度、精灵、待拾取蛋与种植园作物
- 家园查询默认关闭；开启后会按用户记住上次成功查询的 UID，下次可直接发送 `查家园`
- 按当前轮次缓存结构化数据
- 同轮次内优先使用缓存，避免高频请求
- 缓存落盘到 `data/roco-world-merchant/cache.json`
- 启用家园查询后，查询状态落盘到 `data/roco-world-merchant/home-query.json`
- 主源解析模块化拆分，便于后续单独维护数据源、缓存和渲染逻辑
- 卡片图片会尽量内嵌商品图标，并优先以 PNG 形式发送，兼容 QQ 等客户端
- 卡片 PNG 由 `puppeteer` 服务渲染，不再依赖 `sharp`
- 支持关注物品匹配提醒，命中后可尝试 `@全体`

## 安装

在 Koishi 插件市场搜索 `roco-world-merchant`，或作为本地 workspace 插件直接启用。

启用本插件前，请先安装并启用 `puppeteer` 插件，因为本插件会直接依赖 `ctx.puppeteer` 服务来生成卡片 PNG。

如果部署在 Ubuntu Server 等无桌面环境，只要系统内可用 Chrome / Chromium / Edge，并以 headless 方式启动即可。

## 配置说明

- `primarySourceUrl`: onebiji 页面源地址，作为 arkmeng 失败后的候补页源
- `preferredSource`: 默认数据源，可选 `onebiji`、`arkmeng` 或 `xianyuw`，默认 `arkmeng`
- `apiKey`: 咸鱼备用数据源的 key，可留空
- `apiBaseUrl`: 咸鱼备用数据源接口地址
- `refreshValue`: 透传到咸鱼备用接口的 `refresh` 参数
- `outputMode`: `text`、`image`、`both`
- `homeQueryEnabled`: 是否启用家园查询，默认 `false`
- `homeCommandName`: 家园查询命令名，默认 `查家园`
- `homeCommandAliases`: 家园查询命令别名，默认 `家园查询`
- `homeQueryCacheMinutes`: 家园查询结果短缓存分钟数，默认 `5`
- `scheduleTimes`: 每天定时推送的时间列表，格式为 `HH:mm`，默认 `08:05`、`12:05`、`16:05`、`20:05`
- `timezoneOffset`: 默认 `8`
- `pushTargets`: 主动推送目标列表
- `platform`: 机器人平台，默认 `onebot`
- `selfId`: 用于发消息的机器人 ID，可留空；留空时会自动选择当前平台唯一在线 bot
- `channelId`: 群号或频道 ID
- `guildId`: 某些平台发送频道消息时需要，可留空
- `watch.enabled`: 是否启用关注物品匹配
- `watch.items`: 关注物品列表，默认预置 `国王球`、`棱镜球`、`镜面相框`、`炫彩蛋`、`首领血脉秘药`、`祝福项坠`
- `watch.mentionAllOnMatch`: 命中关注物品时，推送前尝试 `@全体`；如果平台或权限不支持，会自动回退为普通消息

兼容说明：

- 旧配置里的 `scheduleHours` 仍可继续读取，并自动按 `HH:00` 处理
- `platform` 会兼容 `onebot` 与旧配置里的 `qq` 写法

## 指令

- `roco-world-merchant`
- `roco-world-merchant-refresh`
- `查家园 [UID]`：仅在 `homeQueryEnabled` 开启后可用
- 默认别名：`远行商人`、`商人`
- 刷新别名：`刷新远行商人`、`刷新商人`、`强制刷新远行商人`
- 家园查询默认别名：`家园查询`

可选参数：

- `-f, --refresh`：强制刷新并绕过缓存

家园查询示例，需先开启 `homeQueryEnabled`：

- `查家园 100001`：查询 UID 为 `100001` 的家园，并记住这个 UID
- `查家园`：使用当前用户上次成功查询的 UID

## 缓存策略

- 主源成功时，按当前轮次缓存解析结果
- 同一轮次内的主动获取默认直接复用缓存
- 只有缓存过期、没有缓存，或者显式使用 `-f` 时，才会重新请求数据源
- 强制刷新时，会优先尝试当前配置的数据源，并在失败后自动切换到其他可用源
- 切换 `preferredSource` 后，旧源缓存不会被继续直接复用，会按新源重新获取
- 只有所有可用数据源都失败时，才会回退到旧缓存
- `抓取时间` 显示的是插件本次真实请求时间，而不是页面内的服务器时间字段
- 强制刷新会绕过同轮次旧卡片图复用，重新生成最新卡片图片
- 启用家园查询后，会按用户记录上次成功查询的 UID；不同用户互不覆盖
- 启用家园查询后，查询结果默认短缓存 5 分钟，重复查询同一 UID 时优先复用短缓存，减少对洛克万事屋接口的重复请求
- 如果洛克万事屋本次未获取到家园数据，但本地已有该 UID 的旧查询结果，会回退到旧缓存并在消息中说明原因

## 关注物品提醒

- 默认预置 6 个关注物品：`国王球`、`棱镜球`、`镜面相框`、`炫彩蛋`、`首领血脉秘药`、`祝福项坠`
- 支持直接在配置里增删关注物品，支持用部分关键字进行宽松匹配
- 命中后会在消息顶部增加 `【关注物品命中】...` 提示
- 如果开启了 `watch.mentionAllOnMatch`，推送时会先尝试 `@全体`
- 如果平台不支持或机器人没有 `@全体` 权限，会自动改为普通消息继续推送，不会因为提醒失败把整条消息丢掉

## 代码结构

当前源码已经按职责拆分：

- `src/index.ts`: Koishi 插件入口、命令注册、定时调度、推送发送
- `src/schema.ts`: 配置项 Schema
- `src/services/merchant-store.ts`: 缓存、主备源切换、图片确保逻辑
- `src/sources/onebiji.ts`: onebiji 页面候补源抓取与解析
- `src/sources/arkmeng.ts`: 洛克万事屋默认主源抓取，并按页面图标规则补全商品图标
- `src/sources/home.ts`: 洛克万事屋家园查询接口封装
- `src/sources/xianyuw.ts`: 咸鱼备用源接口封装
- `src/services/home-store.ts`: 家园查询 UID 记忆与短缓存
- `src/render/image.ts`: SVG 卡片结构生成
- `src/render/home.ts`: 家园查询文本消息渲染
- `src/render/puppeteer.ts`: 基于 `ctx.puppeteer` 的 PNG 截图渲染
- `src/render/message.ts`: 文本与图片消息拼装
- `src/utils/time.ts`: 分钟级调度与时间工具
- `src/utils/watch.ts`: 关注物品匹配与提醒文案工具

## 页面改版兼容性说明

当前默认主源是 `arkmeng` 的免登录接口；它虽然不需要 key，但也不是官方稳定公开 API，所以无法保证站点大改后一定无感继续工作。

为了尽量提高抗改版能力，这个插件现在会按下面顺序获取数据：

1. 先请求 `arkmeng` 的游客 token，再调用 `/api/server-function` 获取本轮商品与截止时间
2. 再读取 `/merchant` 页面前端规则，优先校验图标路径规则是否仍存在
3. 如果 `arkmeng` 失败，会自动回退到 `onebiji` 页面源，最后才尝试已配置 key 的咸鱼源
4. 家园查询会调用 `ingameQuery` 并传入 `uid`；如果洛克万事屋调整该接口名或返回字段，家园查询需要同步适配

这意味着：

- 如果 `arkmeng` 只是页面 chunk 名、静态资源路径或局部脚本有轻微调整，接口数据通常仍有机会继续取到
- 如果 `/api/web-auth/guest`、`/api/server-function` 或其返回结构整体变化，`arkmeng` 主源会失败并自动切换到后备源
- 如果洛克万事屋远行商人接口返回 `_source: pending` 或空商品列表，插件会把它识别为“暂未获取到”，并继续尝试后备源
- 即使 `arkmeng` 页面里的图标规则失效，插件也会先回退到按商品名推导的固定图标路径，而不是立刻整源失败
- `onebiji` 候补源依旧保留了多套脚本变量和 DOM 解析规则；只有所有可用源都失败时，才会回退到旧缓存
- 如果家园数据里的 `overview`、`pets`、`lands`、`plots` 等字段变化，插件会尽量展示可读字段，但完整展示可能需要更新解析逻辑

## 鸣谢

感谢 `洛克万事屋` 及其作者对本插件的支持。

经沟通，作者已允许本插件使用其未登录即可请求的相关接口，作为洛克王国世界远行商人数据的可用来源之一。
