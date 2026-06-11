import { resolve } from 'node:path'

import { Context, Logger } from 'koishi'

import { ConfigSchema } from './schema'
import { buildMessage } from './render/message'
import { MerchantStore } from './services/merchant-store'
import { Config as PluginConfig } from './types'
import { getLastScheduleTime, getNextScheduleTime, formatDateTime, formatScheduleKey, normalizeScheduleHours } from './utils/time'

export const name = 'roco-world-merchant'
export const inject = {
  required: ['http'],
}

export const Config = ConfigSchema

export async function apply(ctx: Context, config: PluginConfig) {
  const logger = new Logger(name)
  const stateFile = resolve(ctx.baseDir, 'data', 'roco-world-merchant', 'cache.json')
  const scheduleHours = normalizeScheduleHours(config.scheduleHours)
  const needImageByDefault = config.outputMode !== 'text'
  const store = new MerchantStore({
    ctx,
    logger,
    config,
    stateFile,
    scheduleHours,
  })

  await store.init()

  let cancelNextPush: (() => void) | null = null

  function resolvePushBot(target: PluginConfig['pushTargets'][number]) {
    const requestedSelfId = target.selfId?.trim()
    const exactBot = requestedSelfId
      ? ctx.bots.find(item => item.platform === target.platform && item.selfId === requestedSelfId)
      : null
    if (exactBot) {
      return exactBot
    }

    const samePlatformBots = ctx.bots.filter(item => item.platform === target.platform)
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

  async function handleManualQuery(forceRefresh: boolean) {
    const result = await store.getCache(needImageByDefault, forceRefresh)
    if (!result.entry) {
      return result.warning || '当前未获取到远行商人数据。'
    }

    const message = buildMessage(
      result.entry,
      result.origin,
      result.warning,
      config.timezoneOffset,
      config.outputMode,
    )

    if (!forceRefresh) {
      return message
    }

    const prefix = result.origin === 'stale'
      ? '强制刷新失败，已回退到上一份缓存。'
      : '已强制刷新远行商人数据。'

    return `${prefix}\n${message}`
  }

  async function doPush(scheduleKey: string, reason: 'schedule' | 'startup') {
    if (!config.pushTargets.length) {
      return
    }

    if (store.lastPushedScheduleKey === scheduleKey) {
      logger.info(`跳过重复推送：${scheduleKey}`)
      return
    }

    const result = await store.getCache(needImageByDefault, false)
    if (!result.entry) {
      logger.warn(`未获取到可推送数据：${result.warning || 'empty result'}`)
      return
    }

    const message = buildMessage(
      result.entry,
      result.origin,
      result.warning,
      config.timezoneOffset,
      config.outputMode,
    )
    const errors: string[] = []
    let successCount = 0

    for (const target of config.pushTargets) {
      try {
        const bot = resolvePushBot(target)
        await bot.sendMessage(target.channelId, message, target.guildId || undefined)
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

    const nextTime = getNextScheduleTime(new Date(), scheduleHours, config.timezoneOffset)
    const delay = Math.max(1000, nextTime.getTime() - Date.now())
    const scheduleKey = formatScheduleKey(nextTime, config.timezoneOffset)

    logger.info(`下一次远行商人推送时间：${formatDateTime(nextTime, config.timezoneOffset)} (${scheduleKey})`)

    cancelNextPush = ctx.setTimeout(async () => {
      try {
        await doPush(scheduleKey, 'schedule')
      } finally {
        scheduleNext()
      }
    }, delay)
  }

  async function maybeCatchUpPush() {
    if (!config.pushOnStartupIfMissed) {
      return
    }

    const lastSchedule = getLastScheduleTime(new Date(), scheduleHours, config.timezoneOffset)
    const scheduleKey = formatScheduleKey(lastSchedule, config.timezoneOffset)
    const age = Date.now() - lastSchedule.getTime()
    if (age > Math.max(1, config.startupCatchupWindowMinutes) * 60 * 1000) {
      return
    }

    if (store.lastPushedScheduleKey === scheduleKey) {
      return
    }

    logger.info(`检测到启动补推窗口，准备补推：${scheduleKey}`)
    await doPush(scheduleKey, 'startup')
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
