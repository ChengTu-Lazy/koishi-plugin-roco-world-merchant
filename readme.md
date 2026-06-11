# koishi-plugin-roco-world-merchant

[![npm](https://img.shields.io/npm/v/koishi-plugin-roco-world-merchant?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-roco-world-merchant)

用于获取《洛克王国：世界》远行商人数据的 Koishi 插件。

数据源策略：

- 默认主数据源：`onebiji` 的免 key 页面
- 备用数据源：咸鱼 API
- 当主源失败时，才会回退到咸鱼接口

## 功能

- 每天 `08:00 / 12:00 / 16:00 / 20:00` 主动推送到配置的群或频道
- 支持命令主动获取
- 支持独立的强制刷新命令
- 按当前轮次缓存结构化数据
- 同轮次内优先使用缓存，避免高频请求
- 缓存落盘到 `data/roco-world-merchant/cache.json`
- 主源解析模块化拆分，方便后续单独维护数据源、缓存和渲染逻辑
- SVG 主图会尽量内嵌商品图标，避免客户端丢失外链图片

## 安装

在 Koishi 插件市场搜索 `roco-world-merchant`，或者作为本地 workspace 插件直接启用。

## 配置说明

- `primarySourceUrl`: onebiji 主数据源页面地址
- `apiKey`: 咸鱼备用数据源的 key，可留空
- `apiBaseUrl`: 咸鱼备用数据源接口地址
- `refreshValue`: 透传到咸鱼备用接口的 `refresh` 参数
- `outputMode`: `text`、`image`、`both`
- `scheduleHours`: 默认 `8, 12, 16, 20`
- `timezoneOffset`: 默认 `8`
- `pushTargets`: 主动推送目标列表
- `platform`: 机器人平台，例如 `qq`
- `selfId`: 用于发消息的机器人 ID
- `channelId`: 群号或频道 ID
- `guildId`: 某些平台发送频道消息时需要，可留空

## 指令

- `roco-world-merchant`
- `roco-world-merchant-refresh`
- 默认别名：`远行商人`、`商人`
- 刷新别名：`刷新远行商人`、`刷新商人`、`强制刷新远行商人`

可选参数：

- `-f, --refresh`：强制刷新并绕过缓存

## 缓存策略

- 主源成功时，按当前轮次缓存解析结果
- 同一轮次内的主动获取默认直接复用缓存
- 只有缓存过期、没有缓存，或者显式使用 `-f` 时，才重新请求数据源
- 主源失败且配置了 `apiKey` 时，会自动切换到咸鱼备用源

## 代码结构

当前源码已经按职责拆分：

- `src/index.ts`: Koishi 插件入口、命令注册、定时调度
- `src/schema.ts`: 配置项 Schema
- `src/services/merchant-store.ts`: 缓存、主备源切换、图片确保逻辑
- `src/sources/onebiji.ts`: onebiji 主源抓取与解析
- `src/sources/xianyuw.ts`: 咸鱼备用源接口封装
- `src/render/`: 文本与 SVG 图片渲染
- `src/utils/`: 时间、HTML、数值解析等基础工具

## 页面改版兼容性说明

当前主源是免 key 的 HTML 页面，不是稳定 JSON API，所以无法保证页面大改后一定无感继续工作。

为了尽量提高抗改版能力，这个插件现在会按下面顺序解析主源：

1. 先读页面内联脚本里的 `index`、`hour`、`serverNow` 等状态变量
2. 再回退到 `.time-list`、`.shop-list` 等 DOM 结构
3. 商品名、价格、限购、图片、时间标签都提供了多套候选提取规则

这意味着：

- 如果只是 class 顺序、空白、局部样式、部分标签轻微调整，通常还能继续取到
- 如果关键字段整体被替换，例如 `show_x`、`shop_name`、`shop_price`、`data-time`、`showShopinfo(...)` 同时失效，主源解析仍可能失败
- 主源失败且已配置 `apiKey` 时，插件会自动降级到咸鱼备用源
