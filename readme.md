# koishi-plugin-roco-world-merchant

[![npm](https://img.shields.io/npm/v/koishi-plugin-roco-world-merchant?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-roco-world-merchant)

用于《洛克王国：世界》的 Koishi 插件，支持远行商人推送、公告/活动推送、家园查询与关注物品提醒。

## 功能

- 远行商人定时推送，默认每天 `08:05`、`12:05`、`16:05`、`20:05` 执行。
- 支持手动查询远行商人，并提供强制刷新命令。
- 支持多数据源自动回退：洛克万事屋、onebiji、洛克魔法书、咸鱼备用源。
- 支持公告/活动每日推送，默认关闭，开启后默认每天 `10:00` 检查。
- 支持 `查家园 [UID]` 查询家园信息，可绑定 UID 后直接发送 `查家园`。
- 支持检查家园蛋和成熟作物，并提醒绑定用户。
- 支持关注物品提醒，命中后可尝试 `@全体成员`。
- 支持文字、图片、文字加图片三种输出模式。

## 安装

在 Koishi 插件市场搜索 `roco-world-merchant` 安装并启用。

本插件需要 Koishi 的 `puppeteer` 服务来生成图片卡片，请先安装并启用 `puppeteer` 插件。

## 常用配置

- `preferredSource`: 远行商人默认数据源，默认 `arkmeng`。可选 `arkmeng`、`onebiji`、`magicbook`、`xianyuw`。
- `rocomApiKey`: 洛克魔法书开放 API Key。使用魔法书数据源、公告/活动推送或魔法书家园源时需要填写。
- `apiKey`: 咸鱼备用源 API Key，可不填。
- `outputMode`: 输出模式，可选 `both`、`text`、`image`，默认 `both`。
- `scheduleTimes`: 远行商人推送时间，默认 `08:05`、`12:05`、`16:05`、`20:05`。
- `pushTargets`: 主动推送目标。`platform` 默认 `onebot`，`channelId` 填群号或频道 ID，`selfId` 可留空。
- `homeQueryEnabled`: 是否启用家园查询，默认关闭。
- `homePreferredSource`: 家园查询数据源，默认 `arkmeng`，可选 `magicbook`。
- `announcementPush.enabled`: 是否启用公告/活动推送，默认关闭。
- `watch.enabled`: 是否启用关注物品提醒，默认开启。
- `watch.items`: 关注物品列表，可自行增删。
- `watch.mentionAllOnMatch`: 命中关注物品后是否尝试 `@全体成员`，默认开启。

## 指令

- `roco-world-merchant`: 查询远行商人。
- `roco-world-merchant -f`: 强制刷新远行商人。
- `roco-world-merchant-refresh`: 强制刷新远行商人。
- `远行商人`、`商人`: 查询远行商人的默认别名。
- `刷新远行商人`、`刷新商人`、`强制刷新远行商人`: 强制刷新默认别名。
- `查家园 [UID]`: 查询指定 UID 的家园信息。
- `绑定家园 <UID>`: 绑定当前会话的家园 UID。
- `解绑家园`: 取消绑定家园 UID。
- `我的家园`: 查看当前绑定的家园 UID。

## 家园查询

家园查询默认关闭，需要先在插件配置中开启 `homeQueryEnabled`。

开启后可以发送：

- `查家园 100001`: 查询 UID 为 `100001` 的家园，并记住本次 UID。
- `查家园`: 优先使用当前会话绑定的 UID，其次使用上次查询成功的 UID。
- `绑定家园 100001`: 后续远行商人推送节点会顺带检查是否有蛋未取、菜未收。

## 关注物品提醒

默认关注物品包括：`国王球`、`棱镜球`、`镜面相框`、`炫彩蛋`、`首领血脉秘药`、`祝福项坠`。

可以在 `watch.items` 中自定义关注物品。命中后，插件会在推送消息顶部提示；如果开启 `watch.mentionAllOnMatch`，会尝试 `@全体成员`，失败时自动回退为普通消息。

## 鸣谢

感谢 `洛克万事屋` 及其作者对本插件的支持。

经沟通，作者已允许本插件使用其未登录即可请求的相关接口，作为洛克王国世界远行商人数据的可用来源之一。
