# koishi-plugin-roco-world-merchant

[![npm](https://img.shields.io/npm/v/koishi-plugin-roco-world-merchant?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-roco-world-merchant)

用于《洛克王国：世界》的 Koishi 插件，支持远行商人推送、公告/活动推送、家园查询与关注物品提醒。

## 功能

- 远行商人定时推送，默认每天 `08:05`、`12:05`、`16:05`、`20:05` 执行。
- 支持手动查询远行商人，并提供强制刷新命令。
- 支持多数据源自动回退：洛克万事屋、onebiji、洛克魔法书、咸鱼备用源。
- 支持公告/活动每日推送和手动触发推送，默认关闭，开启后默认每天 `10:00` 检查。
- 公告会展示发布日期；活动会在名称后展示趣味倒计时和开始/结束日期，已过期活动不会展示，临期活动会置顶高亮。
- 支持 `查家园 [UID]` 查询家园信息，可绑定 UID 后直接发送 `查家园`。
- 支持检查家园蛋和成熟作物，并提醒绑定用户。
- 支持 `查蛋` 查询精灵蛋组，或输入身高、体重反查候选精灵及尺寸匹配度。
- 查蛋图片使用精灵图标与分页卡片，突出显示输入数字、匹配度和尺寸范围。
- 支持关注物品提醒，命中后可尝试 `@全体成员`。
- 支持文字、图片、文字加图片三种输出模式。

## 安装

在 Koishi 插件市场搜索 `roco-world-merchant` 安装并启用。

本插件需要 Koishi 的 `puppeteer` 服务来生成图片卡片，请先安装并启用 `puppeteer` 插件。

## 常用配置

- `preferredSource`: 远行商人默认数据源，默认 `arkmeng`。可选 `arkmeng`、`onebiji`、`magicbook`、`xianyuw`。
- `rocomApiKey`: 洛克魔法书开放 API Key。使用魔法书数据源、公告/活动推送或魔法书家园源时需要填写；查蛋名称查询及尺寸反查的魔法书备用源也使用此 Key。
- `apiKey`: 咸鱼备用源 API Key，可不填。
- `outputMode`: 输出模式，可选 `both`、`text`、`image`，默认 `both`。
- `scheduleTimes`: 远行商人推送时间，默认 `08:05`、`12:05`、`16:05`、`20:05`。
- `pushTargets`: 主动推送目标。`platform` 默认 `onebot`，`channelId` 填群号或频道 ID，`selfId` 可留空。
- `homeQueryEnabled`: 是否启用家园查询，默认关闭。
- `homePreferredSource`: 家园查询数据源，默认 `arkmeng`，可选 `magicbook`。
- `announcementPush.enabled`: 是否启用公告/活动推送，默认关闭。
- `announcementPush.fetchDetails`: 定时推送是否额外请求公告详情以补全文本和图片，默认关闭。
- `announcementPush.detailLimit`: 每次最多补全几条公告详情，默认 `3`。
- `announcementPush.recentDays`: 可填写任意非负整数，公告展示最近几天，默认 `3`；`1` 表示今天，`3` 表示今天及前两天，`0` 表示不限。按插件时区计算，仅筛选首页最多 10 条公告；日期缺失时不展示（不限天数时保留）。手动查询和定时推送均生效，不影响活动或公告素材查询。
- `watch.enabled`: 是否启用关注物品提醒，默认开启。
- `watch.items`: 关注物品列表，可自行增删。
- `watch.mentionAllOnMatch`: 命中关注物品后是否尝试 `@全体成员`，默认开启。

## 指令

- `roco-world-merchant`: 查询远行商人。
- `roco-world-merchant -f`: 强制刷新远行商人。
- `roco-world-merchant-refresh`: 强制刷新远行商人。
- `远行商人`、`商人`: 查询远行商人的默认别名。
- `刷新远行商人`、`刷新商人`、`强制刷新远行商人`: 强制刷新默认别名。
- `公告活动推送`: 手动获取公告/活动并回复当前会话，默认会额外请求公告详情，适合 Koishi 沙箱测试。
- `公告活动推送 -t`: 手动获取公告/活动并发送到配置的 `pushTargets`。
- 公告推送展示列表首页最多 10 条（包含置顶公告），卡片标注公告 ID；详情补全仍受 `detailLimit` 限制。
- `公告素材`：获取最新一条公告的原图、视频及正文链接，以可复制的 URL 列表回复。
- `公告素材 53878`：获取指定公告 ID 的素材；别名为 `公告资源`。每次会请求公告详情，不指定 ID 时会额外查询最新公告。
- `公告活动推送 -d`: 兼容参数，手动命令默认已请求公告详情，会补全详情正文和图片。
- `推送公告活动`、`手动推送公告`、`手动推送活动`: 公告/活动手动推送别名。
- `查家园 [UID]`: 查询指定 UID 的家园信息。
- `绑定家园 <UID>`: 绑定当前会话的家园 UID。
- `解绑家园`: 取消绑定家园 UID。
- `我的家园`: 查看当前绑定的家园 UID。
- `查蛋 喵喵`: 查询精灵蛋组、孵化尺寸和可配种精灵；同蛋组可配种精灵默认只展示各家族最低阶形态，避免同一进化链重复出现。
- `查蛋 0.18 1.5`: 按身高（米）、体重（千克）反查精灵；也支持 `查蛋 身高0.18m 体重1.5kg`。
- `查蛋 0.18`、`查蛋 体重1.5kg`: 仅按身高或体重反查。匹配度表示尺寸符合程度，不代表真实孵出概率。
- 查蛋不需要绑定 UID；输入身高和体重时优先使用免 Key 的 BWIKI 工具站，显示参考概率、尺寸匹配度和置信度，默认不限定蛋种。接口失败后尝试魔法书（需 `rocomApiKey`）及内置数据，并提示备用数据可能不完整。名称和单尺寸查询保留原有数据源。

## 家园查询

家园查询默认关闭，需要先在插件配置中开启 `homeQueryEnabled`。

开启后可以发送：

- `查家园 100001`: 查询 UID 为 `100001` 的家园，并记住本次 UID。
- `查家园`: 优先使用当前会话绑定的 UID，其次使用上次查询成功的 UID。
- `绑定家园 100001`: 后续定时节点会检查是否有蛋未取、菜未收。未配置 `pushTargets` 时，会发送到绑定所在群/频道。

## 关注物品提醒

默认关注物品包括：`国王球`、`棱镜球`、`镜面相框`、`炫彩蛋`、`炫彩精灵蛋`、`首领血脉秘药`、`祝福项坠`。

可以在 `watch.items` 中自定义关注物品。命中后，插件会在推送消息顶部提示；如果开启 `watch.mentionAllOnMatch`，会尝试 `@全体成员`，失败时自动回退为普通消息。

## 鸣谢

查蛋功能参考 [Entropy-Increase-Team/koishi-plugin-rocom](https://github.com/Entropy-Increase-Team/koishi-plugin-rocom) 的交互与接口，内置查蛋数据摘录自该项目。数据来源、版本和许可见 `THIRD-PARTY-NOTICES.md` 与 `LICENSE.egg-data`。

尺寸反查使用 [BWIKI 工具站](https://roco.gptvip.chat/hatch-query) 的公开接口，接入方式参考 [OatmeaILL/zhenxun_roco_egg_query](https://github.com/OatmeaILL/zhenxun_roco_egg_query)。

感谢 `洛克万事屋` 及其作者对本插件的支持。

经沟通，作者已允许本插件使用其未登录即可请求的相关接口，作为洛克王国世界远行商人数据的可用来源之一。
