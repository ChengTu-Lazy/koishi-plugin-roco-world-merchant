import { Context } from 'koishi'

import { Config, MerchantData, MerchantItem, PrimarySlot } from '../types'
import { extractAttr, extractEmTexts, extractTextByPatterns, normalizeUrl, parseShowShopinfoArgs } from '../utils/html'
import { buildSlotWindow, formatCountdown, formatDateOnly, parseHourMinute, shiftToTimezone } from '../utils/time'
import { normalizeTimestampMs, parseInteger, parseLimit, parsePrice, uniqueNumbers } from '../utils/parse'

const PRIMARY_SOURCE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36'

interface SlotWindow {
  startTime?: number
  endTime?: number
}

interface ItemCandidate extends MerchantItem {
  slotIndexes: number[]
  visible: boolean
}

export async function fetchPrimaryHtml(ctx: Context, config: Config) {
  return await ctx.http.get(config.primarySourceUrl, {
    timeout: config.requestTimeout,
    headers: {
      'User-Agent': PRIMARY_SOURCE_USER_AGENT,
    },
  }) as string
}

export function parsePrimaryHtml(html: string, timezoneOffset: number) {
  const serverNowSeconds = parseServerNowSeconds(html)
  const serverNowMs = serverNowSeconds * 1000
  const slots = parsePrimarySlots(html)
  if (!slots.length) {
    throw new Error('onebiji 页面中未找到时间段信息')
  }

  const currentSlot = resolveCurrentSlot(html, slots, serverNowMs, timezoneOffset)
  const slotsByIndex = new Map<number, PrimarySlot>(slots.map(slot => [slot.index, slot]))
  const slotWindows = new Map<number, SlotWindow>(
    slots.map(slot => [slot.index, buildSlotWindow(serverNowMs, slot.start, slot.end, timezoneOffset)]),
  )

  const candidates = parseItemCandidates(html, currentSlot, slotsByIndex, slotWindows, serverNowMs)
  const items = selectCurrentItems(candidates, currentSlot.index)
  if (!items.length) {
    throw new Error(`onebiji 页面未解析到第 ${currentSlot.index} 轮商品数据`)
  }

  const currentWindow = slotWindows.get(currentSlot.index)
  const roundEnd = currentWindow?.endTime
    || items.map(item => item.end_time || 0).filter(Boolean).sort((a, b) => b - a)[0]

  return {
    merchant_name: '远行商人',
    subtitle: formatDateOnly(serverNowMs, timezoneOffset),
    fetched_at: new Date(serverNowMs).toISOString(),
    round: {
      current: currentSlot.index,
      total: slots.length,
      status: 'open',
      label: `第${currentSlot.index}轮`,
      countdown: roundEnd ? formatCountdown(roundEnd - serverNowMs) : '',
    },
    item_count: items.length,
    items,
  } satisfies MerchantData
}

function parseServerNowSeconds(html: string) {
  const match = /var\s+serverNow\s*=\s*(\d+)\s*;?/i.exec(html)
  return match ? Number(match[1]) : Math.floor(Date.now() / 1000)
}

function parsePrimarySlots(html: string) {
  const section = extractSection(html, 'ul', 'time-list') || html
  const slots: PrimarySlot[] = []

  for (const match of section.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const attrs = match[1] || ''
    const block = match[2] || ''
    const className = extractAttr(attrs, 'class')
    const slotIndex = parseInteger(extractAttr(attrs, 'data-index'))
      || parseInteger(/\bcheck_(\d+)\b/i.exec(className || '')?.[1])
      || undefined
    const times = extractEmTexts(block).filter(isClockText)

    if (!slotIndex || times.length < 2) {
      continue
    }

    slots.push({
      index: slotIndex,
      start: times[0],
      end: times[1],
      label: `${times[0]}-${times[1]}`,
      active: /\bon\b/.test(className || ''),
    })
  }

  if (slots.length) {
    return uniqueSlots(slots)
  }

  return parseSlotsFromRefreshHours(html)
}

function parseSlotsFromRefreshHours(html: string) {
  const match = /var\s+refreshHour\s*=\s*\[([^\]]+)\]\s*;?/i.exec(html)
  if (!match) return [] as PrimarySlot[]

  const values = match[1]
    .split(',')
    .map(item => Number(item.trim()))
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 24)

  if (values.length < 2) return [] as PrimarySlot[]

  const startOffset = values[0] === 0 ? 1 : 0
  const slots: PrimarySlot[] = []

  for (let index = startOffset; index < values.length; index += 1) {
    const start = values[index]
    const end = values[index + 1] ?? 24
    if (start >= end) continue

    slots.push({
      index: index - startOffset + 1,
      start: `${padHour(start)}:00`,
      end: `${padHour(end)}:00`,
      label: `${padHour(start)}:00-${padHour(end)}:00`,
      active: false,
    })
  }

  return slots
}

function resolveCurrentSlot(html: string, slots: PrimarySlot[], serverNowMs: number, timezoneOffset: number) {
  const scriptIndex = parseInteger(/var\s+index\s*=\s*(\d+)\s*;?/i.exec(html)?.[1])
  if (scriptIndex) {
    const exact = slots.find(slot => slot.index === scriptIndex)
    if (exact) return exact
  }

  const active = slots.find(slot => slot.active)
  if (active) return active

  const scriptedHour = parseInteger(/var\s+hour\s*=\s*(\d+)\s*;?/i.exec(html)?.[1])
  const currentHour = scriptedHour ?? shiftToTimezone(serverNowMs, timezoneOffset).getUTCHours()
  const byHour = slots.find(slot => isHourWithinSlot(currentHour, slot))
  return byHour || slots[0]
}

function parseItemCandidates(
  html: string,
  currentSlot: PrimarySlot,
  slotsByIndex: Map<number, PrimarySlot>,
  slotWindows: Map<number, SlotWindow>,
  serverNowMs: number,
) {
  const section = extractSection(html, 'ul', 'shop-list') || html
  const candidates: ItemCandidate[] = []

  for (const match of section.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const attrs = match[1] || ''
    const block = match[2] || ''
    const className = extractAttr(attrs, 'class')
    if ((className || '').includes('show_none_tip')) {
      continue
    }

    const showInfoArgs = parseShowShopinfoArgs(attrs)
    const visible = isVisibleItem(attrs)
    const rawSlotIndexes = Array.from((className || '').matchAll(/\bshow_(\d+)\b/g))
      .map(item => Number(item[1]))
      .filter(value => Number.isInteger(value) && value > 0)
    const slotIndexes = uniqueNumbers(rawSlotIndexes.length ? rawSlotIndexes : (visible ? [currentSlot.index] : []))
    const itemWindow = getItemWindow(slotIndexes, slotWindows)
    const fallbackEndTime = itemWindow.endTime
    const explicitEndTime = normalizeTimestampMs(extractAttr(attrs, 'data-time'))
    const endTime = explicitEndTime || fallbackEndTime
    const startTime = itemWindow.startTime

    const name = extractTextByPatterns(block, [
      /<em[^>]*class=["'][^"']*shop_name[^"']*["'][^>]*>([\s\S]*?)<\/em>/i,
      /<p[^>]*>\s*<em[^>]*>([\s\S]*?)<\/em>\s*<\/p>/i,
    ]) || showInfoArgs[1] || ''
    if (!name) continue

    const priceText = extractTextByPatterns(block, [
      /<em[^>]*class=["'][^"']*shop_price[^"']*["'][^>]*>([\s\S]*?)<\/em>/i,
      /(价格[:：]\s*[\d.,]+(?:w|W|万)?)/i,
    ])
    const limitText = extractTextByPatterns(block, [
      /<div[^>]*class=["'][^"']*gitem[^"']*["'][^>]*>[\s\S]*?<em>([\s\S]*?)<\/em>/i,
      /(限购\s*\d+)/i,
    ])
    const image = normalizeUrl(extractTextByPatterns(block, [
      /<img[^>]+src=["']([^"'<>]+)["']/i,
    ])) || normalizeUrl(showInfoArgs[0] || '')
    const kind = showInfoArgs[2] || undefined

    candidates.push({
      slotIndexes,
      visible,
      name,
      kind,
      image,
      start_time: startTime,
      end_time: endTime,
      time_label: buildItemTimeLabel(slotIndexes, currentSlot, slotsByIndex),
      countdown: endTime ? formatCountdown(endTime - serverNowMs) : '',
      price: parsePrice(priceText),
      limit: parseLimit(limitText),
      status: endTime ? (endTime > serverNowMs ? 'active' : 'expired') : 'unknown',
    })
  }

  return candidates
}

function selectCurrentItems(candidates: ItemCandidate[], currentSlotIndex: number) {
  const slotMatched = candidates.filter(item => item.slotIndexes.includes(currentSlotIndex))
  if (slotMatched.length) {
    return slotMatched.map(stripCandidateMeta)
  }

  const visibleMatched = candidates.filter(item => item.visible)
  if (visibleMatched.length) {
    return visibleMatched.map(stripCandidateMeta)
  }

  return [] as MerchantItem[]
}

function stripCandidateMeta(candidate: ItemCandidate) {
  const { slotIndexes, visible, ...item } = candidate
  return item
}

function getItemWindow(slotIndexes: number[], slotWindows: Map<number, SlotWindow>) {
  const startTimes: number[] = []
  const endTimes: number[] = []

  for (const slotIndex of slotIndexes) {
    const slotWindow = slotWindows.get(slotIndex)
    if (slotWindow?.startTime) startTimes.push(slotWindow.startTime)
    if (slotWindow?.endTime) endTimes.push(slotWindow.endTime)
  }

  return {
    startTime: startTimes.length ? Math.min(...startTimes) : undefined,
    endTime: endTimes.length ? Math.max(...endTimes) : undefined,
  }
}

function buildItemTimeLabel(slotIndexes: number[], currentSlot: PrimarySlot, slotsByIndex: Map<number, PrimarySlot>) {
  if (!slotIndexes.length) {
    return currentSlot.label
  }

  const ranges = slotIndexes
    .map(index => slotsByIndex.get(index))
    .filter(Boolean)

  if (!ranges.length) {
    return currentSlot.label
  }

  const sorted = [...ranges].sort((a, b) => a.index - b.index)
  const firstSlot = sorted[0]
  const lastSlot = sorted[sorted.length - 1]
  if (!firstSlot?.start || !lastSlot?.end) {
    return currentSlot.label
  }

  return `${firstSlot.start}-${lastSlot.end}`
}

function extractSection(html: string, tagName: 'ul', className: string) {
  const pattern = new RegExp(`<${tagName}[^>]*class=(["'])[^"'<>]*\\b${className}\\b[^"'<>]*\\1[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  return pattern.exec(html)?.[2] || ''
}

function isVisibleItem(attrs: string) {
  const style = extractAttr(attrs, 'style').replace(/\s+/g, '').toLowerCase()
  if (!style) return true
  return !style.includes('display:none')
}

function isClockText(value: string) {
  return Boolean(parseHourMinute(value))
}

function isHourWithinSlot(hour: number, slot: PrimarySlot) {
  const start = parseHourMinute(slot.start)
  const end = parseHourMinute(slot.end)
  if (!start || !end) return false

  const endHour = end.hour === 24 ? 24 : end.hour
  if (start.hour <= endHour) {
    return hour >= start.hour && hour < endHour
  }
  return hour >= start.hour || hour < endHour
}

function uniqueSlots(slots: PrimarySlot[]) {
  const bucket = new Map<number, PrimarySlot>()
  for (const slot of slots) {
    const existing = bucket.get(slot.index)
    if (!existing || slot.active) {
      bucket.set(slot.index, slot)
    }
  }
  return [...bucket.values()].sort((a, b) => a.index - b.index)
}

function padHour(hour: number) {
  return hour.toString().padStart(2, '0')
}
