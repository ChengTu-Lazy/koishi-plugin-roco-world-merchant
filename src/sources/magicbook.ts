import { Context } from 'koishi'

import { callRocomApi } from './rocom-api'
import { buildArkmengItemIconUrl } from './arkmeng'
import { Config, MerchantData, MerchantItem } from '../types'
import { createTimezoneDate, formatCountdown, formatDateOnly, shiftToTimezone } from '../utils/time'
import { normalizeTimestampMs, parseInteger, parseLimit, parsePrice } from '../utils/parse'

const MERCHANT_INFO_PATH = '/api/v1/games/rocom/merchant/info'
const ROUND_WINDOWS = [
  { id: 1, startHour: 8, endHour: 12 },
  { id: 2, startHour: 12, endHour: 16 },
  { id: 3, startHour: 16, endHour: 20 },
  { id: 4, startHour: 20, endHour: 24 },
]

type MagicBookItemCategory = 'normal' | 'round' | 'weekend'

interface MagicBookItem extends MerchantItem {
  category: MagicBookItemCategory
  roundId: number | null
}

interface MagicBookRoundWindow {
  current?: number
  total: number
  status: string
  startTime?: number
  endTime?: number
  label: string
  countdown: string
}

interface RandomGoodsMeta {
  price?: unknown
  limit?: unknown
  startTime?: unknown
  endTime?: unknown
  image?: unknown
}

interface RandomGoodsMetaIndex {
  byName: Map<string, RandomGoodsMeta>
  byId: Map<string, RandomGoodsMeta>
}

export function hasMagicBookSource(config: Config) {
  return Boolean(config.rocomApiKey?.trim())
}

export async function fetchMagicBookMerchantData(ctx: Context, config: Config) {
  if (!hasMagicBookSource(config)) {
    throw new Error('未配置洛克魔法书 API Key（rocomApiKey）')
  }

  const result = await callRocomApi(ctx, config, MERCHANT_INFO_PATH, {
    refresh: 'false',
    random_goods: 'all',
  })
  return normalizeMagicBookMerchantData(result, config.timezoneOffset)
}

function normalizeMagicBookMerchantData(value: unknown, timezoneOffset: number): MerchantData {
  const now = Date.now()
  const root = asRecord(value)
  const container = resolveContainer(root)
  const sourceStatus = readFirstString(container, ['_source', 'source'])
  if (sourceStatus === 'pending') {
    throw new Error('洛克魔法书远行商人数据暂未获取到，当前处于 pending 状态')
  }

  const activities = asArray(container.merchantActivities)
  const activitySelection = selectMagicBookActivity(activities, now)
  const activity = activitySelection.activity
  const shop = asRecord(container.shop)
  const randomGoodsMeta = collectRandomGoodsMeta(container)
  const roundWindow = getCurrentMerchantRoundWindow(now, timezoneOffset)
  const rawItems = Array.isArray(value)
    ? value
    : resolveMagicBookProducts(container, activity, shop, activities)

  const candidateItems = normalizeMagicBookProducts(rawItems, randomGoodsMeta, now, timezoneOffset)

  if (!candidateItems.length) {
    throw new Error(readFirstString(container, ['message', 'error']) || '洛克魔法书接口未返回远行商人商品数据')
  }

  const roundStartTime = roundWindow.startTime
  const roundEndTime = roundWindow.endTime
  const items = selectCurrentMagicBookItems(candidateItems, roundWindow, now)

  if (!items.length) {
    throw new Error(readFirstString(container, ['message', 'error']) || '洛克魔法书接口未返回当前轮次远行商人商品数据')
  }

  return {
    merchant_name: readFirstString(activity, ['name', 'merchant_name'])
      || readFirstString(shop, ['name', 'shop_name', 'shopName'])
      || '远行商人',
    subtitle: formatDateOnly(roundStartTime || now, timezoneOffset),
    fetched_at: new Date(now).toISOString(),
    round: {
      current: roundWindow.current,
      total: roundWindow.total,
      status: roundWindow.status,
      start_time: roundStartTime,
      end_time: roundEndTime,
      label: roundWindow.label,
      countdown: roundWindow.countdown,
    },
    item_count: items.length,
    items,
  }
}

function selectMagicBookActivity(activities: unknown[], now: number) {
  const candidates = activities
    .map((value, index) => {
      const activity = asRecord(value)
      return {
        activity,
        index,
        startTime: normalizeTimestampMs(readFirst(activity, ['start_time', 'startTime'])),
        endTime: normalizeTimestampMs(readFirst(activity, ['end_time', 'endTime'])),
        hasItems: hasActivityItems(activity),
      }
    })
    .filter(item => Object.keys(item.activity).length)

  const activeWithItems = candidates.find(item => item.hasItems && isTimeActive(item.startTime, item.endTime, now))
  if (activeWithItems) return activeWithItems

  const active = candidates.find(item => isTimeActive(item.startTime, item.endTime, now))
  if (active) return active

  const latestStarted = candidates
    .filter(item => item.hasItems && item.startTime && item.startTime <= now)
    .sort((left, right) => (right.startTime || 0) - (left.startTime || 0))[0]
  if (latestStarted) return latestStarted

  const nextActivity = candidates
    .filter(item => item.hasItems && item.startTime && item.startTime > now)
    .sort((left, right) => (left.startTime || 0) - (right.startTime || 0))[0]
  if (nextActivity) return nextActivity

  return candidates.find(item => item.hasItems) || candidates[0] || {
    activity: {},
    index: -1,
    startTime: undefined,
    endTime: undefined,
    hasItems: false,
  }
}

function hasActivityItems(activity: Record<string, unknown>) {
  return readArray(activity, [
    'products',
    'product_list',
    'productList',
    'get_props',
    'getProps',
    'get_extra_props',
    'getExtraProps',
    'get_pets',
    'getPets',
    'items',
    'goods',
    'current_goods',
    'currentGoods',
  ]).length > 0
}

function isTimeActive(startTime: number | undefined, endTime: number | undefined, now: number) {
  if (!startTime && !endTime) return false
  return (!startTime || startTime <= now) && (!endTime || endTime > now)
}

function isItemActive(item: MerchantItem, now: number) {
  return (!item.start_time || item.start_time <= now) && (!item.end_time || item.end_time > now)
}

function getCurrentMerchantRoundWindow(now: number, timezoneOffset: number): MagicBookRoundWindow {
  const zoned = shiftToTimezone(now, timezoneOffset)
  const year = zoned.getUTCFullYear()
  const month = zoned.getUTCMonth()
  const day = zoned.getUTCDate()
  const hour = zoned.getUTCHours()
  const minute = zoned.getUTCMinutes()
  const second = zoned.getUTCSeconds()
  const secondsOfDay = hour * 3600 + minute * 60 + second
  const currentWindow = ROUND_WINDOWS.find(window => hour >= window.startHour && hour < window.endHour)

  if (!currentWindow || secondsOfDay < 8 * 3600) {
    return {
      total: ROUND_WINDOWS.length,
      status: 'closed',
      label: '未开放',
      countdown: '',
    }
  }

  const startDate = createTimezoneDate(year, month, day, currentWindow.startHour, 0, timezoneOffset)
  const endDate = createTimezoneDate(year, month, day, currentWindow.endHour, 0, timezoneOffset)
  return {
    current: currentWindow.id,
    total: ROUND_WINDOWS.length,
    status: 'active',
    startTime: startDate.getTime(),
    endTime: endDate.getTime(),
    label: `${pad(currentWindow.startHour)}:00-${pad(currentWindow.endHour)}:00`,
    countdown: formatCountdown(endDate.getTime() - now),
  }
}

function resolveMagicBookProducts(
  container: Record<string, unknown>,
  activity: Record<string, unknown>,
  shop: Record<string, unknown>,
  activities: unknown[],
) {
  const rows: unknown[] = []
  const productKeys = [
    'products',
    'product_list',
    'productList',
    'get_props',
    'getProps',
    'get_extra_props',
    'getExtraProps',
    'get_pets',
    'getPets',
    'items',
    'goods',
    'current_goods',
    'currentGoods',
  ]

  appendArrays(rows, activity, productKeys)
  if (!rows.length) {
    for (const item of activities) {
      appendArrays(rows, asRecord(item), productKeys)
    }
  }

  appendArrays(rows, shop, ['items', 'goods', 'current_goods', 'currentGoods', 'list'])
  appendArrays(rows, container, ['items', 'goods', 'current_goods', 'currentGoods', 'list'])

  const goodsRecord = asRecord(container.goods)
  for (const value of Object.values(goodsRecord)) {
    if (Array.isArray(value)) {
      rows.push(...value)
    } else {
      rows.push(value)
    }
  }

  if (!rows.length) {
    appendArrays(rows, container, ['random_goods', 'randomGoods'])
  }

  return dedupeMagicBookRows(rows)
}

function normalizeMagicBookProducts(
  rawItems: unknown[],
  randomGoodsMeta: RandomGoodsMetaIndex,
  now: number,
  timezoneOffset: number,
) {
  const items: MagicBookItem[] = []
  const seen = new Set<string>()

  for (const rawItem of rawItems) {
    const item = normalizeMagicBookProduct(asRecord(rawItem), randomGoodsMeta, now, timezoneOffset)
    if (!item) continue

    const key = `${item.name || ''}|${item.start_time || ''}|${item.end_time || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }

  return items
}

function normalizeMagicBookProduct(
  item: Record<string, unknown>,
  randomGoodsMeta: RandomGoodsMetaIndex,
  now: number,
  timezoneOffset: number,
): MagicBookItem | null {
  const nestedItem = asRecord(readFirst(item, ['item', 'goods', 'prop', 'config']))
  const name = readMagicBookItemName(item) || readMagicBookItemName(nestedItem)
  if (!name) return null

  const id = readMagicBookItemId(item) || readMagicBookItemId(nestedItem)
  const meta = randomGoodsMeta.byId.get(id) || randomGoodsMeta.byName.get(name) || {}
  const startTime = normalizeTimestampMs(readFirst(item, ['start_time', 'startTime', 'open_time', 'openTime']))
    || normalizeTimestampMs(readFirst(nestedItem, ['start_time', 'startTime', 'open_time', 'openTime']))
    || normalizeTimestampMs(meta.startTime)
  const endTime = normalizeTimestampMs(readFirst(item, ['end_time', 'endTime', 'close_time', 'closeTime']))
    || normalizeTimestampMs(readFirst(nestedItem, ['end_time', 'endTime', 'close_time', 'closeTime']))
    || normalizeTimestampMs(meta.endTime)
  const category = classifyMagicBookItem(startTime, endTime, timezoneOffset)
  const image = normalizeImageUrl(
    readFirstString(item, ['icon_url', 'iconUrl', 'icon', 'image', 'img', 'pic', 'picture'])
    || readFirstString(nestedItem, ['icon_url', 'iconUrl', 'icon', 'image', 'img', 'pic', 'picture'])
    || readString(meta.image),
  ) || buildArkmengItemIconUrl(name)
  const price = normalizePrice(readFirst(item, ['price', 'shop_price', 'shopPrice', 'cost'])
    ?? readFirst(nestedItem, ['price', 'shop_price', 'shopPrice', 'cost'])
    ?? meta.price)
  const limit = normalizeLimit(readFirst(item, ['limit', 'limited', 'buy_limit', 'buyLimit', 'buy_limit_num', 'buyLimitNum', 'count'])
    ?? readFirst(nestedItem, ['limit', 'limited', 'buy_limit', 'buyLimit', 'buy_limit_num', 'buyLimitNum', 'count'])
    ?? meta.limit)

  return {
    name,
    kind: readFirstString(item, ['kind', 'type', 'category'])
      || readFirstString(nestedItem, ['kind', 'type', 'category'])
      || getCategoryLabel(category),
    image,
    start_time: startTime,
    end_time: endTime,
    time_label: buildTimeLabel(startTime, endTime, timezoneOffset),
    countdown: endTime ? formatCountdown(endTime - now) : '',
    price,
    limit,
    status: endTime ? (endTime > now ? 'active' : 'expired') : 'unknown',
    category,
    roundId: getMagicBookRoundForItem(startTime, now, timezoneOffset),
  }
}

function collectRandomGoodsMeta(container: Record<string, unknown>): RandomGoodsMetaIndex {
  const byName = new Map<string, RandomGoodsMeta>()
  const byId = new Map<string, RandomGoodsMeta>()
  const randomGoods = readArray(container, ['random_goods', 'randomGoods'])

  for (const rawItem of randomGoods) {
    const item = asRecord(rawItem)
    const nestedItem = asRecord(readFirst(item, ['item', 'goods', 'prop', 'config']))
    const name = readMagicBookItemName(item) || readMagicBookItemName(nestedItem)
    const id = readMagicBookItemId(item) || readMagicBookItemId(nestedItem)
    const meta: RandomGoodsMeta = {
      price: readFirst(item, ['price', 'shop_price', 'shopPrice', 'cost']),
      limit: readFirst(item, ['buy_limit_num', 'buyLimitNum', 'limit', 'limited', 'buy_limit', 'buyLimit', 'count']),
      startTime: readFirst(item, ['start_time', 'startTime', 'open_time', 'openTime']),
      endTime: readFirst(item, ['end_time', 'endTime', 'close_time', 'closeTime']),
      image: readFirst(item, ['icon_url', 'iconUrl', 'icon', 'image', 'img', 'pic', 'picture']),
    }

    if (name) byName.set(name, meta)
    if (id) byId.set(id, meta)
  }

  return { byName, byId }
}

function selectCurrentMagicBookItems(items: MagicBookItem[], roundWindow: MagicBookRoundWindow, now: number): MerchantItem[] {
  return items
    .filter(item => {
      if (!isItemActive(item, now)) return false
      if (item.category !== 'round') return true
      return Boolean(roundWindow.current && item.roundId === roundWindow.current)
    })
    .sort((left, right) => getCategoryOrder(left.category) - getCategoryOrder(right.category))
}

function classifyMagicBookItem(
  startTime: number | undefined,
  endTime: number | undefined,
  timezoneOffset: number,
): MagicBookItemCategory {
  if (!startTime || !endTime) return 'normal'

  const durationDays = (endTime - startTime) / (24 * 60 * 60 * 1000)
  if (durationDays >= 2) return 'weekend'

  const startHour = getDecimalHour(startTime, timezoneOffset)
  const endHour = getDecimalHour(endTime, timezoneOffset)
  if (startHour <= 8 && endHour >= 23.5) return 'normal'

  return 'round'
}

function getMagicBookRoundForItem(
  startTime: number | undefined,
  now: number,
  timezoneOffset: number,
) {
  if (!startTime) return null

  const itemDate = shiftToTimezone(startTime, timezoneOffset)
  const nowDate = shiftToTimezone(now, timezoneOffset)
  if (
    itemDate.getUTCFullYear() !== nowDate.getUTCFullYear()
    || itemDate.getUTCMonth() !== nowDate.getUTCMonth()
    || itemDate.getUTCDate() !== nowDate.getUTCDate()
  ) {
    return null
  }

  const startHour = itemDate.getUTCHours() + itemDate.getUTCMinutes() / 60
  return ROUND_WINDOWS.find(window => startHour >= window.startHour && startHour < window.endHour)?.id ?? null
}

function getDecimalHour(value: number, timezoneOffset: number) {
  const zoned = shiftToTimezone(value, timezoneOffset)
  return zoned.getUTCHours() + zoned.getUTCMinutes() / 60
}

function getCategoryLabel(category: MagicBookItemCategory) {
  if (category === 'round') return '本轮商品'
  if (category === 'weekend') return '周末限定'
  return '常驻商品'
}

function getCategoryOrder(category: MagicBookItemCategory) {
  if (category === 'round') return 0
  if (category === 'normal') return 1
  return 2
}

function appendArrays(target: unknown[], record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      target.push(...value)
    }
  }
}

function dedupeMagicBookRows(rows: unknown[]) {
  const result: unknown[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const item = asRecord(row)
    if (!Object.keys(item).length) continue
    const nestedItem = asRecord(readFirst(item, ['item', 'goods', 'prop', 'config']))

    const key = [
      readMagicBookItemId(item) || readMagicBookItemId(nestedItem),
      readMagicBookItemName(item) || readMagicBookItemName(nestedItem),
      readString(readFirst(item, ['start_time', 'startTime']) ?? readFirst(nestedItem, ['start_time', 'startTime'])),
      readString(readFirst(item, ['end_time', 'endTime']) ?? readFirst(nestedItem, ['end_time', 'endTime'])),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }

  return result
}

function readMagicBookItemName(item: Record<string, unknown>) {
  return readFirstString(item, ['name', 'goods_name', 'goodsName', 'item_name', 'itemName', 'title', 'prop_name', 'propName'])
}

function readMagicBookItemId(item: Record<string, unknown>) {
  return readFirstString(item, ['id', 'goods_id', 'goodsId', 'item_id', 'itemId', 'prop_id', 'propId'])
}

function resolveContainer(root: Record<string, unknown>) {
  const result = asRecord(root.result)
  const data = asRecord(root.data)
  if (Object.keys(data).length) return data
  if (Object.keys(result).length) {
    const resultData = asRecord(result.data)
    return Object.keys(resultData).length ? resultData : result
  }
  return root
}

function readArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value) && value.length) return value
  }
  return []
}

function normalizePrice(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return parsePrice(readString(value))
}

function normalizeLimit(value: unknown) {
  const numberValue = parseInteger(value)
  if (numberValue != null) return numberValue
  return parseLimit(readString(value))
}

function buildTimeLabel(startTime: number | undefined, endTime: number | undefined, timezoneOffset: number) {
  if (!startTime || !endTime) return ''
  return `${formatClock(startTime, timezoneOffset)}-${formatClock(endTime, timezoneOffset)}`
}

function formatClock(value: number, timezoneOffset: number) {
  const zoned = shiftToTimezone(value, timezoneOffset)
  return `${pad(zoned.getUTCHours())}:${pad(zoned.getUTCMinutes())}`
}

function readFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function readFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readString(record[key])
    if (value) return value
  }
  return ''
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function normalizeImageUrl(url: string) {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  try {
    return new URL(url, 'https://wegame.shallow.ink').toString()
  } catch {
    return ''
  }
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}
