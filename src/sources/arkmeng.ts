import { Context } from 'koishi'

import { ARKMENG_BASE_URL } from '../constants'
import { Config, MerchantData, MerchantItem } from '../types'
import { normalizeTimestampMs, parseInteger, parseLimit, parsePrice } from '../utils/parse'
import { formatCountdown, formatDateOnly, shiftToTimezone } from '../utils/time'

export const ARKMENG_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36'

type IconResolver = (name: string, explicitUrl?: unknown) => string

interface ArkmengGuestResponse {
  ok?: boolean
  token?: string
  message?: string
  error?: string
}

interface ArkmengFunctionResponse {
  result?: unknown
  message?: string
  error?: string
}

export async function fetchArkmengMerchantData(ctx: Context, config: Config) {
  const [result, resolveIcon] = await Promise.all([
    fetchArkmengMerchantResult(ctx, config),
    createArkmengPageIconResolver(ctx, config).catch(() => resolveArkmengItemIcon),
  ])

  return normalizeArkmengMerchantResult(result, config.timezoneOffset, resolveIcon)
}

export async function fetchArkmengMerchantResult(ctx: Context, config: Config) {
  return await callArkmengServerFunction(ctx, config, 'merchant', {}, '/merchant')
}

export async function callArkmengServerFunction(
  ctx: Context,
  config: Config,
  name: string,
  data: Record<string, unknown> = {},
  refererPath = '/',
) {
  const token = await fetchArkmengGuestToken(ctx, config, refererPath)
  const response = await ctx.http.post(arkmengUrl('/api/server-function'), {
    name,
    data,
  }, {
    timeout: config.requestTimeout,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: ARKMENG_BASE_URL,
      Referer: arkmengUrl(refererPath),
      'User-Agent': ARKMENG_USER_AGENT,
    },
  }) as ArkmengFunctionResponse

  if (!response || !('result' in response)) {
    throw new Error(`arkmeng server-function ${name} 返回异常：${response?.message || response?.error || 'missing result'}`)
  }

  return response.result
}

export async function fetchArkmengGuestToken(ctx: Context, config: Config, refererPath = '/merchant') {
  const response = await ctx.http.post(arkmengUrl('/api/web-auth/guest'), undefined, {
    timeout: config.requestTimeout,
    headers: {
      Origin: ARKMENG_BASE_URL,
      Referer: arkmengUrl(refererPath),
      'User-Agent': ARKMENG_USER_AGENT,
    },
  }) as ArkmengGuestResponse

  if (!response?.token) {
    throw new Error(`arkmeng 游客 token 获取失败：${response?.message || response?.error || 'missing token'}`)
  }

  return response.token
}

export function normalizeArkmengMerchantResult(
  result: unknown,
  timezoneOffset: number,
  resolveIcon: IconResolver = resolveArkmengItemIcon,
) {
  const now = Date.now()
  const root = asRecord(result)
  const data = asRecord(root.data)
  const container = Object.keys(data).length ? data : root
  const sourceStatus = readStringValue(root._source) || readStringValue(container._source)
  if (sourceStatus === 'pending') {
    throw new Error('洛克万事屋远行商人数据暂未获取到，当前处于 pending 状态')
  }

  const activities = asArray(container.merchantActivities)
  const activity = asRecord(activities[0])
  const rawItems = resolveRawItems(container, activity, activities)
  const activityStartTime = normalizeTimestampMs(readFirst(activity, ['start_time', 'startTime']))
  const activityEndTime = normalizeTimestampMs(readFirst(activity, ['end_time', 'endTime']))

  const items = rawItems
    .map(rawItem => normalizeArkmengItem(asRecord(rawItem), activityStartTime, activityEndTime, now, timezoneOffset, resolveIcon))
    .filter((item): item is MerchantItem => Boolean(item))
    .slice(0, 6)

  if (!items.length) {
    const message = readStringValue(container.message) || readStringValue(root.message)
    throw new Error(message || '洛克万事屋接口未返回远行商人商品数据')
  }

  const startTimes = items
    .map(item => item.start_time)
    .filter((value): value is number => Boolean(value))
  const endTimes = items
    .map(item => item.end_time)
    .filter((value): value is number => Boolean(value))
  const roundStartTime = startTimes.length ? Math.min(...startTimes) : activityStartTime
  const roundEndTime = endTimes.length ? Math.max(...endTimes) : activityEndTime
  const timeLabel = buildTimeLabel(roundStartTime, roundEndTime, timezoneOffset)
  const status = roundEndTime ? (roundEndTime > now ? 'active' : 'expired') : 'unknown'

  return {
    merchant_name: readString(activity, ['name', 'merchant_name']) || '远行商人',
    subtitle: formatDateOnly(roundStartTime || now, timezoneOffset),
    fetched_at: new Date(now).toISOString(),
    round: {
      status,
      label: timeLabel || '本轮在售',
      countdown: roundEndTime ? formatCountdown(roundEndTime - now) : '',
    },
    item_count: items.length,
    items,
  } satisfies MerchantData
}

export function buildArkmengItemIconUrl(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return ''

  const encodedPath = `/图片/远行商人/${trimmed}.png`
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
  return `${ARKMENG_BASE_URL}/storage/files${encodedPath}`
}

async function createArkmengPageIconResolver(ctx: Context, config: Config): Promise<IconResolver> {
  const helperScript = await fetchArkmengMerchantHelperScript(ctx, config)
  // arkmeng 页面当前用这个 helper 从商品名推导图标路径；刷新时验证一次页面规则仍存在。
  if (!helperScript.includes('/storage/files') || !helperScript.includes('/图片/远行商人/')) {
    throw new Error('arkmeng 页面图标规则未匹配')
  }
  return resolveArkmengItemIcon
}

async function fetchArkmengMerchantHelperScript(ctx: Context, config: Config) {
  const pageUrl = arkmengUrl('/merchant')
  const html = await getText(ctx, pageUrl, config)
  const entryPath = extractFirst(html, /<script[^>]+src=(["'])([^"']*\/assets\/index-[^"']+\.js)\1/i, 2)
  if (!entryPath) {
    throw new Error('arkmeng merchant 页面未找到入口脚本')
  }

  const entryUrl = resolveUrl(entryPath, pageUrl)
  const entryScript = await getText(ctx, entryUrl, config)
  const merchantViewPath = extractFirst(entryScript, /["'](\.\/MerchantView-[^"']+\.js)["']/i)
  if (!merchantViewPath) {
    throw new Error('arkmeng 入口脚本未找到 MerchantView chunk')
  }

  const merchantViewUrl = resolveUrl(merchantViewPath, entryUrl)
  const merchantViewScript = await getText(ctx, merchantViewUrl, config)
  const merchantHelperPath = extractFirst(merchantViewScript, /["'](\.\/merchant-[^"']+\.js)["']/i)
  if (!merchantHelperPath) {
    throw new Error('arkmeng MerchantView 未找到 merchant helper chunk')
  }

  return await getText(ctx, resolveUrl(merchantHelperPath, merchantViewUrl), config)
}

async function getText(ctx: Context, url: string, config: Config) {
  return await ctx.http.get(url, {
    timeout: config.requestTimeout,
    headers: {
      'User-Agent': ARKMENG_USER_AGENT,
    },
  }) as string
}

function normalizeArkmengItem(
  item: Record<string, unknown>,
  activityStartTime: number | undefined,
  activityEndTime: number | undefined,
  now: number,
  timezoneOffset: number,
  resolveIcon: IconResolver,
): MerchantItem | null {
  const name = readString(item, ['name', 'goodsName', 'title', 'nm'])
  if (!name) return null

  const startTime = normalizeTimestampMs(readFirst(item, ['start_time', 'startTime'])) || activityStartTime
  const endTime = normalizeTimestampMs(readFirst(item, ['end_time', 'endTime'])) || activityEndTime
  const timeLabel = buildTimeLabel(startTime, endTime, timezoneOffset)
  const price = normalizePrice(readFirst(item, ['price', 'pr', 'shop_price']))
  const limit = normalizeLimit(readFirst(item, ['limit', 'limited', 'buy_limit']))

  return {
    name,
    kind: readString(item, ['kind', 'type']) || undefined,
    image: resolveIcon(name, readFirst(item, ['icon_url', 'icon', 'image', 'img'])),
    start_time: startTime,
    end_time: endTime,
    time_label: timeLabel,
    countdown: endTime ? formatCountdown(endTime - now) : '',
    price,
    limit,
    status: endTime ? (endTime > now ? 'active' : 'expired') : 'unknown',
  } satisfies MerchantItem
}

function resolveRawItems(container: Record<string, unknown>, activity: Record<string, unknown>, activities: unknown[]) {
  const activityItems = asArray(activity.get_props)
  if (activityItems.length) return activityItems
  if (Array.isArray(activity.get_props)) return []

  const items = asArray(container.items)
  if (items.length) return items

  return activities
}

function resolveArkmengItemIcon(name: string, explicitUrl?: unknown) {
  const normalized = normalizeArkmengUrl(readStringValue(explicitUrl))
  return normalized || buildArkmengItemIconUrl(name)
}

function normalizeArkmengUrl(url: string) {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  try {
    return new URL(url, ARKMENG_BASE_URL).toString()
  } catch {
    return ''
  }
}

function normalizePrice(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return parsePrice(readStringValue(value))
}

function normalizeLimit(value: unknown) {
  const numberValue = parseInteger(value)
  if (numberValue != null) return numberValue
  return parseLimit(readStringValue(value))
}

function buildTimeLabel(startTime: number | undefined, endTime: number | undefined, timezoneOffset: number) {
  if (!startTime || !endTime) return ''
  return `${formatClock(startTime, timezoneOffset)}-${formatClock(endTime, timezoneOffset)}`
}

function formatClock(value: number, timezoneOffset: number) {
  const zoned = shiftToTimezone(value, timezoneOffset)
  return `${pad(zoned.getUTCHours())}:${pad(zoned.getUTCMinutes())}`
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readStringValue(record[key])
    if (value) return value
  }
  return ''
}

function readStringValue(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function readFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function extractFirst(text: string, pattern: RegExp, group = 1) {
  return pattern.exec(text)?.[group] || ''
}

function resolveUrl(path: string, baseUrl: string) {
  return new URL(path, baseUrl).toString()
}

function arkmengUrl(path: string) {
  return new URL(path, ARKMENG_BASE_URL).toString()
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}
