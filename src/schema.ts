import { Schema } from 'koishi'

import { BACKUP_SOURCE_URL, DEFAULT_SCHEDULE_TIMES, DEFAULT_WATCH_ITEMS, PRIMARY_SOURCE_URL } from './constants'
import { Config } from './types'

export const ConfigSchema: Schema<Config> = Schema.object({
  primarySourceUrl: Schema.string()
    .default(PRIMARY_SOURCE_URL)
    .description('主数据源页面地址，默认使用 onebiji 的洛克王国世界远行商人页面。'),
  preferredSource: Schema.union([
    Schema.const('onebiji').description('主源 onebiji 优先'),
    Schema.const('arkmeng').description('洛克万事屋 arkmeng 优先'),
    Schema.const('xianyuw').description('咸鱼源优先'),
  ]).default('onebiji').description('默认数据源。切换后会优先使用该源；若该源失败，仍会自动尝试其他可用源。'),
  apiKey: Schema.string().default('').description('咸鱼备用数据源的 API key，可留空。'),
  apiBaseUrl: Schema.string()
    .default(BACKUP_SOURCE_URL)
    .description('咸鱼备用数据源接口地址。'),
  refreshValue: Schema.string().default('').description('透传到咸鱼备用接口的 refresh 参数，通常保持为空即可。'),
  outputMode: Schema.union([
    Schema.const('both').description('文字 + 图片'),
    Schema.const('text').description('仅文字'),
    Schema.const('image').description('仅图片'),
  ]).default('both').description('主动推送与命令返回的默认格式。'),
  commandName: Schema.string().default('roco-world-merchant').description('主命令名。'),
  commandAliases: Schema.array(Schema.string())
    .default(['远行商人', '商人'])
    .role('table')
    .description('命令别名列表。'),
  timezoneOffset: Schema.number().default(8).description('定时推送使用的时区偏移，默认东八区。'),
  scheduleTimes: Schema.array(Schema.string())
    .default(DEFAULT_SCHEDULE_TIMES)
    .role('table')
    .description('每天定时推送的时间，格式为 HH:mm。'),
  pushTargets: Schema.array(Schema.object({
    name: Schema.string().default('').description('备注'),
    platform: Schema.string().default('onebot').description('平台'),
    selfId: Schema.string().default('').description('机器人'),
    channelId: Schema.string().description('群/频道'),
    guildId: Schema.string().default('').description('Guild'),
  }))
    .default([])
    .role('table')
    .description('推送目标列表，机器人列留空时会自动选当前平台唯一在线 bot。'),
  requestTimeout: Schema.number().role('ms').default(15000).description('接口请求超时。'),
  pushOnStartupIfMissed: Schema.boolean().default(true).description('机器人在推送点附近重启时，是否自动补推一次。'),
  startupCatchupWindowMinutes: Schema.number().default(30).description('允许补推的启动窗口分钟数。'),
  watch: Schema.object({
    enabled: Schema.boolean().default(true).description('是否启用关注物品匹配。'),
    items: Schema.array(Schema.string())
      .default(DEFAULT_WATCH_ITEMS)
      .role('table')
      .description('关注物品列表，支持自定义新增或删减。'),
    mentionAllOnMatch: Schema.boolean()
      .default(true)
      .description('命中关注物品时，推送前尝试 @全体；如果平台或权限不支持，会自动回退为普通消息。'),
  }).default({
    enabled: true,
    items: DEFAULT_WATCH_ITEMS,
    mentionAllOnMatch: true,
  }).description('关注物品提醒配置。'),
})
