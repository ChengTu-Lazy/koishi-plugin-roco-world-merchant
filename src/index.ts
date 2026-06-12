import { resolve } from 'node:path'

import { Context, Logger, h } from 'koishi'

import { DEFAULT_WATCH_ITEMS } from './constants'
import { ConfigSchema } from './schema'
import { buildMessage } from './render/message'
import { MerchantStore } from './services/merchant-store'
import { CacheEntry, Config as PluginConfig, PushTarget } from './types'
import { formatDateTime, formatLegacyScheduleKey, formatScheduleKey, getLastScheduleTime, getNextScheduleTime, normalizeScheduleTimes } from './utils/time'
import { buildWatchNotice, findWatchMatch } from './utils/watch'

export const name = 'roco-world-merchant'
export const inject = {
  required: ['http', 'puppeteer'],
}

export const Config = ConfigSchema

export async function apply(ctx: Context, config: PluginConfig) {
  const logger = new Logger(name)
  const stateFile = resolve(ctx.baseDir, 'data', 'roco-world-merchant', 'cache.json')
  const scheduleTimes = normalizeScheduleTimes(config.scheduleTimes, config.scheduleHours)
  const watchConfig = {
    enabled: config.watch?.enabled ?? true,
    items: config.watch?.items?.length ? config.watch.items : DEFAULT_WATCH_ITEMS,
    mentionAllOnMatch: config.watch?.mentionAllOnMatch ?? true,
  }
  const needImageByDefault = config.outputMode !== 'text'
  const store = new MerchantStore({
    ctx,
    logger,
    config,
    stateFile,
    scheduleTimes,
  })

  await store.init()

  let cancelNextPush: (() => void) | null = null

  function isScheduleAlreadyPushed(scheduleTime: Date) {
    const currentKey = formatScheduleKey(scheduleTime, config.timezoneOffset)
    const legacyKey = formatLegacyScheduleKey(scheduleTime, config.timezoneOffset)
    return store.lastPushedScheduleKey === currentKey || store.lastPushedScheduleKey === legacyKey
  }

  function getPlatformAliases(platform: string) {
    const normalized = platform.trim().toLowerCase()
    const aliases = new Set([normalized])
    if (normalized === 'qq' || normalized === 'onebot') {
      aliases.add('qq')
      aliases.add('onebot')
    }
    return aliases
  }

  function matchPlatform(botPlatform: string, targetPlatform: string) {
    return getPlatformAliases(targetPlatform).has(botPlatform.trim().toLowerCase())
  }

  function resolvePushBot(target: PushTarget) {
    const requestedSelfId = target.selfId?.trim()
    const exactBot = requestedSelfId
      ? ctx.bots.find(item => matchPlatform(item.platform, target.platform) && item.selfId === requestedSelfId)
      : null
    if (exactBot) {
      return exactBot
    }

    const samePlatformBots = ctx.bots.filter(item => matchPlatform(item.platform, target.platform))
    if (samePlatformBots.length === 1) {
      const fallbackBot = samePlatformBots[0]
      const reason = requestedSelfId
        ? `未找到机器人 ${target.platform}:${requestedSelfId}`
        : `未填写 ${target.platform} 平台的 selfId`
      logger.warn(`${reason}，已自动回退到唯一在线机器人 ${fallbackBot.platform}:${fallbackBot.selfId}`)
      return fallbackBot
    }

    if (!samePlatformBots.length) {
      if (!requestedSelfId) {
        throw new Error(`未填写 ${target.platform} 平台的 selfId，且当前平台没有在线机器人`)
      }
      throw new Error(`未找到机器人 ${target.platform}:${requestedSelfId}，当前平台没有在线机器人`)
    }

    const availableSelfIds = samePlatformBots.map(item => item.selfId).join(', ')
    if (!requestedSelfId) {
      throw new Error(`未填写 ${target.platform} 平台的 selfId，当前可用 selfId：${availableSelfIds}`)
    }
    throw new Error(`未找到机器人 ${target.platform}:${requestedSelfId}，当前可用 selfId：${availableSelfIds}`)
  }

  function buildOutputMessage(resultEntry: CacheEntry | null, origin: 'cache' | 'live' | 'stale', warning?: string) {
    if (!resultEntry) {
      return null
    }

    const baseMessage = buildMessage(
      resultEntry,
      origin,
      warning,
      config.timezoneOffset,
      config.outputMode,
    )

    const watchMatch = watchConfig.enabled
      ? findWatchMatch(resultEntry.data.items, watchConfig.items)
      : null
    const watchNotice = watchMatch ? buildWatchNotice(watchMatch) : ''
    const finalMessage = watchNotice ? `${watchNotice}\n${baseMessage}` : baseMessage

    return {
      finalMessage,
      watchMatch,
    }
  }

  async function handleManualQuery(forceRefresh: boolean) {
    const result = await store.getCache(needImageByDefault, forceRefresh)
    if (!result.entry) {
      return result.warning || '当前未获取到远行商人数据。'
    }

    const output = buildOutputMessage(result.entry, result.origin, result.warning)
    const message = output?.finalMessage || ''
    if (!forceRefresh) {
      return message
    }

    const prefix = result.origin === 'stale'
      ? '强制刷新失败，已尝试所有可用数据源并回退到旧缓存。'
      : '已强制刷新远行商人数据。'

    return `${prefix}\n${message}`
  }

  async function sendTargetMessage(target: PushTarget, message: string, shouldMentionAll: boolean) {
    const bot = resolvePushBot(target)
    if (!shouldMentionAll) {
      await bot.sendMessage(target.channelId, message, target.guildId || undefined)
      return
    }

    const mentionAllMessage = `${h.at('all')}\n${message}`
    try {
      await bot.sendMessage(target.channelId, mentionAllMessage, target.guildId || undefined)
    } catch (error) {
      logger.warn(`关注物品命中但 @全体 发送失败，已回退普通消息：${target.platform}:${target.channelId} -> ${error instanceof Error ? error.message : String(error)}`)
      await bot.sendMessage(target.channelId, message, target.guildId || undefined)
    }
  }

  async function doPush(scheduleTime: Date, reason: 'schedule' | 'startup') {
    if (!config.pushTargets.length) {
      return
    }

    const scheduleKey = formatScheduleKey(scheduleTime, config.timezoneOffset)
    if (isScheduleAlreadyPushed(scheduleTime)) {
      logger.info(`跳过重复推送：${scheduleKey}`)
      return
    }

    const result = await store.getCache(needImageByDefault, false)
    if (!result.entry) {
      logger.warn(`未获取到可推送数据：${result.warning || 'empty result'}`)
      return
    }

    const output = buildOutputMessage(result.entry, result.origin, result.warning)
    const message = output?.finalMessage || ''
    const shouldMentionAll = Boolean(output?.watchMatch && watchConfig.enabled && watchConfig.mentionAllOnMatch)
    const errors: string[] = []
    let successCount = 0

    for (const target of config.pushTargets) {
      try {
        await sendTargetMessage(target, message, shouldMentionAll)
        successCount += 1
      } catch (error) {
        const label = target.name || `${target.platform}:${target.selfId}:${target.channelId}`
        const detail = `${label} -> ${error instanceof Error ? error.message : String(error)}`
        errors.push(detail)
        logger.warn(`远行商人推送失败：${detail}`)
      }
    }

    if (successCount > 0) {
      await store.rememberPush(scheduleKey)
    }

    if (!successCount && errors.length) {
      logger.warn(`本次推送全部失败，未记录已推送状态。触发原因：${reason}`)
    } else if (errors.length) {
      logger.warn(`本次推送完成，但有 ${errors.length} 个目标失败。触发原因：${reason}`)
    } else {
      logger.info(`远行商人推送完成：${scheduleKey} (${reason})`)
    }
  }

  function scheduleNext() {
    cancelNextPush?.()

    const nextTime = getNextScheduleTime(new Date(), scheduleTimes, config.timezoneOffset)
    const delay = Math.max(1000, nextTime.getTime() - Date.now())
    const scheduleKey = formatScheduleKey(nextTime, config.timezoneOffset)

    logger.info(`下一次远行商人推送时间：${formatDateTime(nextTime, config.timezoneOffset)} (${scheduleKey})`)

    cancelNextPush = ctx.setTimeout(async () => {
      try {
        await doPush(nextTime, 'schedule')
      } finally {
        scheduleNext()
      }
    }, delay)
  }

  async function maybeCatchUpPush() {
    if (!config.pushOnStartupIfMissed) {
      return
    }

    const lastSchedule = getLastScheduleTime(new Date(), scheduleTimes, config.timezoneOffset)
    const scheduleKey = formatScheduleKey(lastSchedule, config.timezoneOffset)
    const age = Date.now() - lastSchedule.getTime()
    if (age > Math.max(1, config.startupCatchupWindowMinutes) * 60 * 1000) {
      return
    }

    if (isScheduleAlreadyPushed(lastSchedule)) {
      return
    }

    logger.info(`检测到启动补推窗口，准备补推：${scheduleKey}`)
    await doPush(lastSchedule, 'startup')
  }

  ctx.on('ready', async () => {
    await maybeCatchUpPush()
    scheduleNext()
  })

  ctx.on('dispose', () => {
    cancelNextPush?.()
    cancelNextPush = null
  })

  const command = ctx.command(config.commandName, '获取洛克王国世界远行商人数据')
    .option('refresh', '-f, --refresh 强制刷新并绕过缓存')
    .action(async ({ options }) => handleManualQuery(Boolean(options.refresh)))

  const aliases = config.commandAliases.filter(Boolean)
  if (aliases.length) {
    command.alias(...aliases)
  }

  const refreshCommandName = `${config.commandName}-refresh`
  const refreshCommandAliases = Array.from(new Set([
    ...aliases.map(alias => `刷新${alias}`),
    '强制刷新远行商人',
  ].filter(Boolean)))

  const refreshCommand = ctx.command(refreshCommandName, '强制刷新洛克王国世界远行商人数据')
    .action(async () => handleManualQuery(true))

  if (refreshCommandAliases.length) {
    refreshCommand.alias(...refreshCommandAliases)
  }
}
