import { Schema } from 'koishi'

import {
  DEFAULT_ANNOUNCEMENT_PUSH_TIME,
  DEFAULT_SCHEDULE_TIMES,
  DEFAULT_WATCH_ITEMS,
} from './constants'
import { Config } from './types'

export const ConfigSchema = Schema.object({
  preferredSource: Schema.union([
    Schema.const('onebiji').description('onebiji 页面源优先'),
    Schema.const('arkmeng').description('洛克万事屋 arkmeng 优先'),
    Schema.const('magicbook').description('洛克魔法书开放 API 优先，需要 rocomApiKey'),
    Schema.const('xianyuw').description('咸鱼源优先'),
  ]).default('arkmeng').description('默认数据源。默认优先使用 arkmeng；若该源失败，仍会自动尝试其他可用源。'),
  apiKey: Schema.string().default('').description('咸鱼备用数据源的 API key，可留空。'),
  rocomApiKey: Schema.string()
    .default('')
    .description('洛克魔法书开放 API 的 X-API-Key，用于公告/活动等付费接口；不填写时不会请求这些接口。'),
  outputMode: Schema.union([
    Schema.const('both').description('文字 + 图片'),
    Schema.const('text').description('仅文字'),
    Schema.const('image').description('仅图片'),
  ]).default('both').description('主动推送与命令返回的默认格式。'),
  homeQueryEnabled: Schema.boolean()
    .default(false)
    .description('是否启用家园查询功能。默认关闭；开启后才会注册查家园命令并请求家园数据源。'),
  homePreferredSource: Schema.union([
    Schema.const('arkmeng').description('洛克万事屋优先'),
    Schema.const('magicbook').description('洛克魔法书开放 API 优先，需要 rocomApiKey'),
  ]).default('arkmeng').description('家园查询默认数据源；首选源失败后会尝试另一个可用源。'),
  homeCheck: Schema.object({
    enabled: Schema.boolean()
      .default(true)
      .description('是否在远行商人定时节点同步检查已绑定 UID 的家园蛋和成熟作物。仅在 homeQueryEnabled 开启且存在绑定时请求。'),
    mentionUser: Schema.boolean()
      .default(true)
      .description('家园提醒命中时是否 @ 绑定用户。'),
    maxBindingsPerTarget: Schema.number()
      .default(20)
      .description('单个推送目标每轮最多检查的家园绑定数量，用于控制请求量。'),
  }).default({
    enabled: true,
    mentionUser: true,
    maxBindingsPerTarget: 20,
  }).description('家园定时检查配置。'),
  scheduleTimes: Schema.array(Schema.string())
    .default(DEFAULT_SCHEDULE_TIMES)
    .role('table')
    .description('每天定时推送的时间，格式为 HH:mm。'),
  pushTargets: Schema.array(Schema.object({
    name: Schema.string().default('').description('备注'),
    platform: Schema.string().default('onebot').description('平台'),
    selfId: Schema.string().default('').description('机器人'),
    channelId: Schema.string().description('群/频道'),
  }))
    .default([])
    .role('table')
    .description('推送目标列表，机器人列留空时会自动选当前平台唯一在线 bot。'),
  announcementPush: Schema.object({
    enabled: Schema.boolean()
      .default(false)
      .description('是否启用公告/活动定时推送。默认关闭，避免升级后自动产生付费请求。'),
    time: Schema.string()
      .default(DEFAULT_ANNOUNCEMENT_PUSH_TIME)
      .description('每天检查公告/活动的时间，格式为 HH:mm。默认 10:00。'),
    mode: Schema.union([
      Schema.const('activities').description('仅活动信息，通常 1 次接口请求'),
      Schema.const('announcement').description('仅最新公告，通常 1 次接口请求'),
      Schema.const('both').description('公告 + 活动，通常 2 次接口请求'),
    ]).default('both').description('公告/活动推送内容范围。'),
    fetchDetails: Schema.boolean()
      .default(false)
      .description('定时推送是否额外请求公告详情以补全文本和图片。会按公告条数增加付费请求，默认关闭。'),
    detailLimit: Schema.number()
      .default(3)
      .description('每次最多额外请求几条公告详情；定时推送在 fetchDetails 开启时生效，手动命令默认生效。'),
    onlyNotifyOnChange: Schema.boolean()
      .default(false)
      .description('是否仅在内容变化时推送；无论是否推送，每天检查仍会产生对应接口请求。'),
  }).default({
    enabled: false,
    time: DEFAULT_ANNOUNCEMENT_PUSH_TIME,
    mode: 'both',
    fetchDetails: false,
    detailLimit: 3,
    onlyNotifyOnChange: false,
  }).description('公告/活动定时推送配置。'),
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
}) as Schema<Config>
