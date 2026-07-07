import { resolve } from 'node:path'

import { Context, Logger, h } from 'koishi'

import {
  BACKUP_SOURCE_URL,
  DEFAULT_ANNOUNCEMENT_PUSH_TIME,
  DEFAULT_SCHEDULE_TIMES,
  DEFAULT_WATCH_ITEMS,
  PRIMARY_SOURCE_URL,
  ROCOM_API_BASE_URL,
} from './constants'
import { ConfigSchema } from './schema'
import { buildAnnouncementMessage, renderAnnouncementSvgImage } from './render/announcement'
import { buildHomeAlertMessage, HomeAlertEntry } from './render/home-alert'
import { renderHomeSvgImage } from './render/home-image'
import { buildHomeQueryMessage } from './render/home'
import { buildMessage } from './render/message'
import { renderPngWithPuppeteer } from './render/puppeteer'
import { AnnouncementStore, createAnnouncementSignature } from './services/announcement-store'
import { AssetCache } from './services/asset-cache'
import { HomeStore } from './services/home-store'
import { MerchantStore } from './services/merchant-store'
import { isValidHomeUid, normalizeHomeUid } from './sources/home'
import { AnnouncementData, CacheEntry, Config as PluginConfig, HomeBinding, HomeQueryResult, PushTarget } from './types'
import { formatError } from './utils/error'
import { summarizeHomeAlert } from './utils/home'
import { formatDateTime, formatLegacyScheduleKey, formatScheduleKey, getLastScheduleTime, getNextScheduleTime, normalizeScheduleTimes, parseHourMinute } from './utils/time'
import { buildWatchNotice, findWatchMatch } from './utils/watch'

export const name = 'roco-world-merchant'
export const inject = {
  required: ['http', 'puppeteer'],
}

export const Config = ConfigSchema

export async function apply(ctx: Context, config: PluginConfig) {
  config = resolveConfigDefaults(config)
  const logger = new Logger(name)
  const stateFile = resolve(ctx.baseDir, 'data', 'roco-world-merchant', 'cache.json')
  const homeStateFile = resolve(ctx.baseDir, 'data', 'roco-world-merchant', 'home-query.json')
  const announcementStateFile = resolve(ctx.baseDir, 'data', 'roco-world-merchant', 'announcement.json')
  const assetCacheDir = resolve(ctx.baseDir, 'data', 'roco-world-merchant', 'assets')
  const scheduleTimes = normalizeScheduleTimes(config.scheduleTimes, config.scheduleHours)
  const watchConfig = {
    enabled: config.watch?.enabled ?? true,
    items: config.watch?.items?.length ? config.watch.items : DEFAULT_WATCH_ITEMS,
    mentionAllOnMatch: config.watch?.mentionAllOnMatch ?? true,
  }
  const homeCheckConfig = {
    enabled: config.homeCheck?.enabled ?? true,
    mentionUser: config.homeCheck?.mentionUser ?? true,
    maxBindingsPerTarget: Math.max(1, config.homeCheck?.maxBindingsPerTarget ?? 20),
  }
  const announcementConfig = {
    enabled: config.announcementPush?.enabled ?? false,
    time: config.announcementPush?.time || '10:00',
    onlyNotifyOnChange: config.announcementPush?.onlyNotifyOnChange ?? false,
  }
  const needImageByDefault = config.outputMode !== 'text'
  const store = new MerchantStore({
    ctx,
    logger,
    config,
    stateFile,
    scheduleTimes,
  })
  const homeStore = config.homeQueryEnabled
    ? new HomeStore({
      ctx,
      logger,
      config,
      stateFile: homeStateFile,
    })
    : null
  const announcementStore = new AnnouncementStore({
    ctx,
    logger,
    config,
    stateFile: announcementStateFile,
  })
  const assetCache = new AssetCache({
    ctx,
    logger,
    config,
    cacheDir: assetCacheDir,
  })

  await store.init()
  await homeStore?.init()
  await announcementStore?.init()

  let cancelNextPush: (() => void) | null = null
  let cancelNextAnnouncementPush: (() => void) | null = null

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

  async function handleHomeQuery(session: any, rawUid?: string) {
    if (!homeStore) {
      return '家园查询功能未开启，请先在插件配置中启用 homeQueryEnabled。'
    }

    const rememberKey = getHomeRememberKey(session)
    const inputUid = normalizeHomeUid(rawUid)
    const boundUid = homeStore.getBoundUid(session)
    const uid = inputUid || boundUid || homeStore.getRememberedUid(rememberKey)

    if (!uid) {
      return '请在命令后输入 UID，例如：查家园 100001。也可以先发送：绑定家园 100001，之后直接发送：查家园'
    }

    if (!isValidHomeUid(uid)) {
      return 'UID 必须为 6-12 位纯数字。'
    }

    try {
      const result = await homeStore.query(uid)
      await homeStore.rememberUid(rememberKey, uid)
      return await buildHomeQueryOutput(result)
    } catch (error) {
      return `家园查询失败：${formatError(error)}`
    }
  }

  async function buildHomeQueryOutput(result: HomeQueryResult) {
    const text = buildHomeQueryMessage(result, config.timezoneOffset)
    if (config.outputMode === 'text') {
      return text
    }

    try {
      const image = renderHomeSvgImage(result, config.timezoneOffset)
      image.svg = await assetCache.inlineSvgImages(image.svg)
      const buffer = await renderPngWithPuppeteer(ctx, image)
      const imageTag = h.image(buffer, 'image/png').toString()
      if (config.outputMode === 'image') {
        return imageTag
      }
      return `${text}\n${imageTag}`
    } catch (error) {
      logger.warn(`家园查询图片生成失败，已回退文字消息：${formatError(error)}`)
      return text
    }
  }

  async function buildAnnouncementOutput(data: AnnouncementData) {
    const text = buildAnnouncementMessage(data, config.timezoneOffset)
    if (config.outputMode === 'text') {
      return text
    }

    try {
      const image = renderAnnouncementSvgImage(data, config.timezoneOffset)
      image.svg = await assetCache.inlineSvgImages(image.svg)
      const buffer = await renderPngWithPuppeteer(ctx, image)
      const imageTag = h.image(buffer, 'image/png').toString()
      if (config.outputMode === 'image') {
        return imageTag
      }
      return `${text}\n${imageTag}`
    } catch (error) {
      logger.warn(`公告/活动图片生成失败，已回退文字消息：${formatError(error)}`)
      return text
    }
  }

  async function sendAnnouncementToTargets(message: string) {
    const errors: string[] = []
    let successCount = 0

    for (const target of config.pushTargets) {
      try {
        await sendTargetMessage(target, message, false)
        successCount += 1
      } catch (error) {
        const label = target.name || `${target.platform}:${target.selfId}:${target.channelId}`
        const detail = `${label} -> ${formatError(error)}`
        errors.push(detail)
        logger.warn(`公告/活动推送失败：${detail}`)
      }
    }

    return { successCount, errors }
  }

  async function handleHomeBind(session: any, rawUid?: string) {
    if (!homeStore) {
      return '家园查询功能未开启，请先在插件配置中启用 homeQueryEnabled。'
    }

    const uid = normalizeHomeUid(rawUid)
    if (!uid) {
      return '请在命令后输入要绑定的 UID，例如：绑定家园 100001'
    }

    if (!isValidHomeUid(uid)) {
      return 'UID 必须为 6-12 位纯数字。'
    }

    try {
      const binding = await homeStore.bindSession(session, uid)
      await homeStore.rememberUid(getHomeRememberKey(session), uid)
      return `已绑定家园 UID：${binding.uid}。之后可直接发送“查家园”，远行商人推送节点也会检查是否有蛋未取或菜未收。`
    } catch (error) {
      return `家园绑定失败：${formatError(error)}`
    }
  }

  async function handleHomeUnbind(session: any) {
    if (!homeStore) {
      return '家园查询功能未开启，请先在插件配置中启用 homeQueryEnabled。'
    }

    const binding = await homeStore.unbindSession(session)
    if (!binding) {
      return '当前群/用户还没有绑定家园 UID。'
    }

    return `已解绑家园 UID：${binding.uid}。`
  }

  function handleHomeBindingInfo(session: any) {
    if (!homeStore) {
      return '家园查询功能未开启，请先在插件配置中启用 homeQueryEnabled。'
    }

    const binding = homeStore.getBinding(session)
    if (!binding) {
      return '当前群/用户还没有绑定家园 UID。可以发送：绑定家园 100001'
    }

    return `当前绑定家园 UID：${binding.uid}。可发送“查家园”直接查询，或发送“解绑家园”取消绑定。`
  }

  function getHomeRememberKey(session: any) {
    const platform = session?.platform || 'unknown'
    if (session?.userId) return `${platform}:user:${session.userId}`
    if (session?.channelId) return `${platform}:channel:${session.channelId}`
    return `${platform}:global`
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

  async function doHomeCheck(scheduleTime: Date, reason: 'schedule' | 'startup') {
    if (!homeStore || !homeCheckConfig.enabled) {
      return
    }

    const scheduleKey = formatScheduleKey(scheduleTime, config.timezoneOffset)
    if (homeStore.lastCheckedScheduleKey === scheduleKey) {
      logger.info(`跳过重复家园检查：${scheduleKey}`)
      return
    }

    const allBindings = homeStore.listBindings()
    if (!allBindings.length) {
      return
    }

    const homeCheckTargets = getHomeCheckTargets(allBindings)
    const queryCache = new Map<string, Promise<HomeQueryResult>>()
    let checkedCount = 0
    let notifiedCount = 0

    for (const target of homeCheckTargets) {
      const targetBindings = allBindings
        .filter(binding => isBindingForTarget(binding, target))
        .slice(0, homeCheckConfig.maxBindingsPerTarget)
      if (!targetBindings.length) {
        continue
      }

      checkedCount += targetBindings.length
      const entries = (await Promise.all(targetBindings.map(async (binding) => {
        try {
          const result = await queryBoundHome(binding, queryCache)
          const alert = summarizeHomeAlert(result.home)
          if (!alert.hasAlert) {
            return null
          }

          return {
            binding,
            result,
            eggs: alert.eggs,
            ripePlots: alert.ripePlots,
          } satisfies HomeAlertEntry
        } catch (error) {
          logger.warn(`家园定时检查失败：${binding.platform}:${binding.channelId}:${binding.userId} UID ${binding.uid} -> ${formatError(error)}`)
          return null
        }
      }))).filter((entry): entry is HomeAlertEntry => Boolean(entry))

      if (!entries.length) {
        continue
      }

      const message = buildHomeAlertMessage(entries, config.timezoneOffset, homeCheckConfig.mentionUser)
      try {
        await sendTargetMessage(target, message, false)
        notifiedCount += entries.length
      } catch (error) {
        const label = target.name || `${target.platform}:${target.selfId}:${target.channelId}`
        logger.warn(`家园提醒推送失败：${label} -> ${formatError(error)}`)
      }
    }

    if (checkedCount > 0) {
      await homeStore.rememberHomeCheck(scheduleKey)
      logger.info(`家园检查完成：${scheduleKey} (${reason})，检查 ${checkedCount} 个绑定，提醒 ${notifiedCount} 个绑定`)
    }
  }

  function getHomeCheckTargets(bindings: HomeBinding[]) {
    if (config.pushTargets.length) {
      return config.pushTargets
    }

    const targets = new Map<string, PushTarget>()
    for (const binding of bindings) {
      const key = `${binding.platform}:${binding.guildId || ''}:${binding.channelId}`
      if (!targets.has(key)) {
        targets.set(key, {
          name: `家园绑定 ${binding.platform}:${binding.channelId}`,
          platform: binding.platform,
          selfId: '',
          channelId: binding.channelId,
          guildId: binding.guildId,
        })
      }
    }
    return [...targets.values()]
  }

  function queryBoundHome(binding: HomeBinding, queryCache: Map<string, Promise<HomeQueryResult>>) {
    if (!homeStore) {
      throw new Error('家园查询功能未开启')
    }

    const cached = queryCache.get(binding.uid)
    if (cached) {
      return cached
    }

    const promise = homeStore.query(binding.uid, { forceRefresh: true })
    queryCache.set(binding.uid, promise)
    return promise
  }

  function isBindingForTarget(binding: HomeBinding, target: PushTarget) {
    const targetAliases = getPlatformAliases(target.platform)
    const bindingPlatform = binding.platform.trim().toLowerCase()
    if (!targetAliases.has(bindingPlatform)) {
      return false
    }
    if (binding.channelId !== target.channelId) {
      return false
    }
    if (target.guildId && binding.guildId && target.guildId !== binding.guildId) {
      return false
    }
    return true
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

    const result = await store.getCache(needImageByDefault, true)
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

  async function runScheduleNode(scheduleTime: Date, reason: 'schedule' | 'startup') {
    try {
      await doPush(scheduleTime, reason)
    } catch (error) {
      logger.warn(`远行商人推送节点异常：${formatError(error)}`)
    }

    try {
      await doHomeCheck(scheduleTime, reason)
    } catch (error) {
      logger.warn(`家园检查节点异常：${formatError(error)}`)
    }
  }

  async function doAnnouncementPush(scheduleTime: Date) {
    if (!announcementConfig.enabled || !config.pushTargets.length) {
      return
    }

    const scheduleKey = formatScheduleKey(scheduleTime, config.timezoneOffset)
    if (announcementStore.lastPushedKey === scheduleKey) {
      logger.info(`跳过重复公告/活动推送：${scheduleKey}`)
      return
    }

    if (!config.rocomApiKey?.trim()) {
      logger.warn('公告/活动推送已开启，但未配置 rocomApiKey，已跳过本次请求。')
      return
    }

    let data
    try {
      data = await announcementStore.fetchLatest()
    } catch (error) {
      logger.warn(`公告/活动获取失败：${formatError(error)}`)
      return
    }

    const signature = createAnnouncementSignature(data)
    if (announcementConfig.onlyNotifyOnChange && signature && signature === announcementStore.lastSignature) {
      await announcementStore.rememberPush(scheduleKey, signature)
      logger.info(`公告/活动内容无变化，跳过推送：${scheduleKey}`)
      return
    }

    if (!data.items.length) {
      await announcementStore.rememberPush(scheduleKey, signature)
      logger.info(`公告/活动本次无可推送内容：${scheduleKey}`)
      return
    }

    const message = await buildAnnouncementOutput(data)
    const { successCount, errors } = await sendAnnouncementToTargets(message)

    if (successCount > 0) {
      await announcementStore.rememberPush(scheduleKey, signature)
    }

    if (!successCount && errors.length) {
      logger.warn('本次公告/活动推送全部失败，未记录已推送状态。')
    } else if (errors.length) {
      logger.warn(`本次公告/活动推送完成，但有 ${errors.length} 个目标失败。`)
    } else {
      logger.info(`公告/活动推送完成：${scheduleKey}`)
    }
  }

  async function handleManualAnnouncementPush(sendToTargets: boolean, fetchDetails = true) {
    if (!config.rocomApiKey?.trim()) {
      return '公告/活动推送需要先配置 rocomApiKey。'
    }

    if (sendToTargets && !config.pushTargets.length) {
      return '请先在插件配置中添加 pushTargets，或直接发送“公告活动推送”在当前会话查看。'
    }

    let data
    try {
      data = await announcementStore.fetchLatest({ fetchDetails })
    } catch (error) {
      return `公告/活动获取失败：${formatError(error)}`
    }

    const message = await buildAnnouncementOutput(data)
    if (!sendToTargets) {
      return message
    }

    const { successCount, errors } = await sendAnnouncementToTargets(message)
    if (!successCount) {
      return `公告/活动手动推送失败：${errors.join('；') || '没有成功发送的目标'}`
    }

    const failedText = errors.length ? `，失败 ${errors.length} 个：${errors.join('；')}` : ''
    return `已手动触发公告/活动推送：成功 ${successCount} 个目标，共 ${data.items.length} 条内容${failedText}`
  }

  function scheduleNext() {
    cancelNextPush?.()

    const nextTime = getNextScheduleTime(new Date(), scheduleTimes, config.timezoneOffset)
    const delay = Math.max(1000, nextTime.getTime() - Date.now())
    const scheduleKey = formatScheduleKey(nextTime, config.timezoneOffset)

    logger.info(`下一次远行商人/家园检查节点时间：${formatDateTime(nextTime, config.timezoneOffset)} (${scheduleKey})`)

    cancelNextPush = ctx.setTimeout(async () => {
      try {
        await runScheduleNode(nextTime, 'schedule')
      } finally {
        scheduleNext()
      }
    }, delay)
  }

  function scheduleNextAnnouncementPush() {
    cancelNextAnnouncementPush?.()
    if (!announcementStore || !announcementConfig.enabled) {
      return
    }

    const announcementTime = parseHourMinute(announcementConfig.time) || { hour: 10, minute: 0 }
    const nextTime = getNextScheduleTime(new Date(), [announcementTime], config.timezoneOffset)
    const delay = Math.max(1000, nextTime.getTime() - Date.now())
    const scheduleKey = formatScheduleKey(nextTime, config.timezoneOffset)

    logger.info(`下一次公告/活动推送时间：${formatDateTime(nextTime, config.timezoneOffset)} (${scheduleKey})`)

    cancelNextAnnouncementPush = ctx.setTimeout(async () => {
      try {
        await doAnnouncementPush(nextTime)
      } finally {
        scheduleNextAnnouncementPush()
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

    logger.info(`检测到启动补推窗口，准备补推：${scheduleKey}`)
    await runScheduleNode(lastSchedule, 'startup')
  }

  ctx.on('ready', async () => {
    await maybeCatchUpPush()
    scheduleNext()
    scheduleNextAnnouncementPush()
  })

  ctx.on('dispose', () => {
    cancelNextPush?.()
    cancelNextPush = null
    cancelNextAnnouncementPush?.()
    cancelNextAnnouncementPush = null
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

  ctx.command('公告活动推送', '手动触发一次公告/活动推送')
    .option('targets', '-t, --targets 发送到配置的 pushTargets')
    .option('details', '-d, --details 请求公告详情（手动命令默认开启，保留兼容）')
    .alias('推送公告活动', '手动推送公告', '手动推送活动')
    .action(async ({ options }) => handleManualAnnouncementPush(
      Boolean(options.targets),
      options.details ? true : undefined,
    ))

  if (config.homeQueryEnabled) {
    const homeCommandName = config.homeCommandName?.trim() || '查家园'
    const homeCommand = ctx.command(`${homeCommandName} [uid:string]`, '查询洛克王国世界家园信息')
      .action(async ({ session }, uid) => handleHomeQuery(session, uid))

    const homeAliases = (config.homeCommandAliases || []).filter(Boolean)
    if (homeAliases.length) {
      homeCommand.alias(...homeAliases)
    }

    ctx.command('绑定家园 <uid:string>', '绑定当前群/用户的洛克王国世界家园 UID')
      .action(async ({ session }, uid) => handleHomeBind(session, uid))

    ctx.command('解绑家园', '解绑当前群/用户的家园 UID')
      .action(async ({ session }) => handleHomeUnbind(session))

    ctx.command('我的家园', '查看当前群/用户绑定的家园 UID')
      .action(async ({ session }) => handleHomeBindingInfo(session))
  }
}

function resolveConfigDefaults(config: PluginConfig): PluginConfig {
  return {
    ...config,
    primarySourceUrl: config.primarySourceUrl || PRIMARY_SOURCE_URL,
    preferredSource: config.preferredSource || 'arkmeng',
    apiKey: config.apiKey || '',
    apiBaseUrl: config.apiBaseUrl || BACKUP_SOURCE_URL,
    rocomApiKey: config.rocomApiKey || '',
    rocomApiBaseUrl: config.rocomApiBaseUrl || ROCOM_API_BASE_URL,
    refreshValue: config.refreshValue ?? '',
    outputMode: config.outputMode || 'both',
    commandName: config.commandName?.trim() || 'roco-world-merchant',
    commandAliases: Array.isArray(config.commandAliases) ? config.commandAliases : ['远行商人', '商人'],
    homeQueryEnabled: config.homeQueryEnabled ?? false,
    homePreferredSource: config.homePreferredSource || 'arkmeng',
    homeCommandName: config.homeCommandName?.trim() || '查家园',
    homeCommandAliases: Array.isArray(config.homeCommandAliases) ? config.homeCommandAliases : ['家园查询'],
    homeQueryCacheMinutes: config.homeQueryCacheMinutes ?? 5,
    timezoneOffset: config.timezoneOffset ?? 8,
    scheduleTimes: config.scheduleTimes?.length ? config.scheduleTimes : DEFAULT_SCHEDULE_TIMES,
    pushTargets: config.pushTargets || [],
    requestTimeout: config.requestTimeout ?? 15000,
    pushOnStartupIfMissed: config.pushOnStartupIfMissed ?? true,
    startupCatchupWindowMinutes: config.startupCatchupWindowMinutes ?? 30,
    watch: {
      enabled: config.watch?.enabled ?? true,
      items: config.watch?.items?.length ? config.watch.items : DEFAULT_WATCH_ITEMS,
      mentionAllOnMatch: config.watch?.mentionAllOnMatch ?? true,
    },
    announcementPush: {
      enabled: config.announcementPush?.enabled ?? false,
      time: config.announcementPush?.time || DEFAULT_ANNOUNCEMENT_PUSH_TIME,
      mode: config.announcementPush?.mode || 'both',
      fetchDetails: config.announcementPush?.fetchDetails ?? false,
      detailLimit: config.announcementPush?.detailLimit ?? 3,
      onlyNotifyOnChange: config.announcementPush?.onlyNotifyOnChange ?? false,
    },
    homeCheck: {
      enabled: config.homeCheck?.enabled ?? true,
      mentionUser: config.homeCheck?.mentionUser ?? true,
      maxBindingsPerTarget: config.homeCheck?.maxBindingsPerTarget ?? 20,
    },
  }
}
