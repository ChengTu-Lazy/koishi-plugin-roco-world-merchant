import { Schema } from 'koishi'

import { BACKUP_SOURCE_URL, DEFAULT_SCHEDULE_HOURS, PRIMARY_SOURCE_URL } from './constants'
import { Config } from './types'

export const ConfigSchema: Schema<Config> = Schema.object({
  primarySourceUrl: Schema.string()
    .default(PRIMARY_SOURCE_URL)
    .description('主数据源页面地址，默认使用 onebiji 的洛克王国世界远行商人页面。'),
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
  scheduleHours: Schema.array(Schema.number())
    .default(DEFAULT_SCHEDULE_HOURS)
    .role('table')
    .description('每天定时推送的整点小时。'),
  pushTargets: Schema.array(Schema.object({
    name: Schema.string().default('').description('目标备注，可留空。'),
    platform: Schema.string().default('qq').description('机器人平台，例如 qq。'),
    selfId: Schema.string().description('负责发送消息的机器人 selfId。'),
    channelId: Schema.string().description('目标群号或频道 ID。'),
    guildId: Schema.string().default('').description('部分平台发送频道消息时需要，可留空。'),
  }))
    .default([])
    .role('table')
    .description('主动推送的群或频道列表。'),
  requestTimeout: Schema.number().role('ms').default(15000).description('接口请求超时。'),
  pushOnStartupIfMissed: Schema.boolean().default(true).description('机器人在推送点附近重启时，是否自动补推一次。'),
  startupCatchupWindowMinutes: Schema.number().default(30).description('允许补推的启动窗口分钟数。'),
})
