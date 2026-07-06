import { Context } from 'koishi'

import { callRocomApi } from './rocom-api'
import { AnnouncementData, AnnouncementItem, AnnouncementPushMode, Config } from '../types'
import { formatError } from '../utils/error'
import { normalizeTimestampMs } from '../utils/parse'

const LATEST_ANNOUNCEMENT_PATH = '/api/v1/games/rocom/announcement/latest'
const ANNOUNCEMENT_DETAIL_PATH = '/api/v1/games/rocom/announcement/detail'
const ACTIVITIES_INFO_PATH = '/api/v1/games/rocom/activities/info'
const DEFAULT_DETAIL_LIMIT = 3
const ACTIVITY_ENDING_SOON_THRESHOLD = 2 * 24 * 60 * 60 * 1000
const PUBLISH_TIME_KEYS = [
  'publish_time',
  'publishTime',
  'publish_at',
  'publishAt',
  'published_at',
  'publishedAt',
  'published_at_ts',
  'publishedAtTs',
  'release_time',
  'releaseTime',
  'release_at',
  'releaseAt',
]
const START_TIME_KEYS = [
  'start_time',
  'startTime',
  'start_at',
  'startAt',
  'begin_time',
  'beginTime',
  'begin_at',
  'beginAt',
  'open_time',
  'openTime',
  'active_start_time',
  'activeStartTime',
]
const END_TIME_KEYS = [
  'end_time',
  'endTime',
  'end_at',
  'endAt',
  'finish_time',
  'finishTime',
  'finish_at',
  'finishAt',
  'close_time',
  'closeTime',
  'expire_time',
  'expireTime',
  'expired_at',
  'expiredAt',
  'active_end_time',
  'activeEndTime',
]
const SUMMARY_TEXT_KEYS = [
  'summary',
  'desc',
  'description',
  'activity_desc',
  'activityDesc',
  'details',
  'detail_text',
  'detailText',
  'content',
  'content_html',
  'contentHtml',
  'detail',
  'intro',
  'remark',
  'body',
  'html',
]
const CONTENT_TEXT_KEYS = [
  'text',
  'summary',
  'desc',
  'description',
  'details',
  'detail_text',
  'detailText',
  'content',
  'content_html',
  'contentHtml',
  'detail',
  'body',
  'html',
]
const DIRECT_IMAGE_KEYS = [
  'image',
  'image_url',
  'imageUrl',
  'img',
  'pic',
  'picture',
  'cover',
  'cover_url',
  'coverUrl',
  'poster',
  'poster_url',
  'posterUrl',
  'banner',
  'banner_url',
  'bannerUrl',
  'thumb',
  'thumbnail',
  'share_img',
  'shareImg',
]
const IMAGE_LIST_KEYS = [
  'images',
  'imageUrls',
  'image_urls',
  'pics',
  'pictures',
  'posters',
  'banners',
]
const MEDIA_CONTAINER_KEYS = [
  'content',
  'indexes',
  'index',
  'media',
  'medias',
  'attachments',
  'attachment',
  'resources',
  'resource',
  'items',
  'list',
]

export interface AnnouncementFetchOptions {
  fetchDetails?: boolean
  detailLimit?: number
}

export async function fetchAnnouncementData(
  ctx: Context,
  config: Config,
  mode: AnnouncementPushMode,
  options: AnnouncementFetchOptions = {},
): Promise<AnnouncementData> {
  const items: AnnouncementItem[] = []
  const warnings: string[] = []
  const baseUrl = config.rocomApiBaseUrl

  if (mode === 'announcement' || mode === 'both') {
    try {
      const data = await callRocomApi(ctx, config, LATEST_ANNOUNCEMENT_PATH)
      items.push(...normalizeItems(data, '公告', baseUrl))
    } catch (error) {
      warnings.push(`最新公告获取失败：${formatError(error)}`)
    }
  }

  if (mode === 'activities' || mode === 'both') {
    try {
      const data = await callRocomApi(ctx, config, ACTIVITIES_INFO_PATH)
      items.push(...normalizeItems(data, '活动', baseUrl))
    } catch (error) {
      warnings.push(`活动信息获取失败：${formatError(error)}`)
    }
  }

  if (!items.length && warnings.length) {
    throw new Error(warnings.join('；'))
  }

  const dedupedItems = dedupeItems(items)
  const shouldFetchDetails = options.fetchDetails ?? config.announcementPush?.fetchDetails ?? false
  if (shouldFetchDetails) {
    await enrichAnnouncementDetails(
      ctx,
      config,
      dedupedItems,
      normalizeDetailLimit(options.detailLimit ?? config.announcementPush?.detailLimit),
      warnings,
    )
  }
  const visibleItems = prepareVisibleItems(dedupedItems, Date.now())

  return {
    fetchedAt: Date.now(),
    mode,
    items: visibleItems,
    warnings: warnings.length ? warnings : undefined,
  }
}

function normalizeItems(value: unknown, type: AnnouncementItem['type'], baseUrl: string) {
  return collectCandidateItems(value)
    .map(item => normalizeItem(asRecord(item), type, baseUrl))
    .filter((item): item is AnnouncementItem => Boolean(item))
}

function normalizeItem(record: Record<string, unknown>, type: AnnouncementItem['type'], baseUrl: string): AnnouncementItem | null {
  const title = readFirstString(record, [
    'title',
    'name',
    'activity_name',
    'activityName',
    'notice_title',
    'thread_title',
    'threadTitle',
    'subject',
  ])
  if (!title) return null

  const id = readFirstString(record, [
    'id',
    'thread_id',
    'threadId',
    'activity_id',
    'activityId',
    'notice_id',
    'noticeId',
    'tid',
  ])
  const publishedAt = readTime(record, PUBLISH_TIME_KEYS)
  const startAt = readTime(record, START_TIME_KEYS)
  const endAt = readTime(record, END_TIME_KEYS)

  return {
    type,
    id,
    detailId: readFirstString(record, ['thread_id', 'threadId', 'tid']) || id,
    title,
    summary: readAnnouncementSummary(record),
    publishedAt,
    startAt,
    endAt,
    time: type === '公告'
      ? publishedAt || readTime(record, ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'time', 'tt'])
      : startAt || publishedAt || readTime(record, ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'time', 'tt']),
    url: normalizeUrl(readFirstString(record, ['url', 'link', 'jump_url', 'jumpUrl', 'href']), baseUrl),
    imageUrls: normalizeImageList(collectImageUrls(record, baseUrl)),
    status: readFirstString(record, ['status', 'state', 'tag']),
  }
}

async function enrichAnnouncementDetails(
  ctx: Context,
  config: Config,
  items: AnnouncementItem[],
  limit: number,
  warnings: string[],
) {
  if (limit <= 0) return

  const detailTargets = items
    .filter(item => item.type === '公告' && item.detailId)
    .slice(0, limit)

  for (const item of detailTargets) {
    try {
      const detail = await callRocomApi(ctx, config, ANNOUNCEMENT_DETAIL_PATH, {
        thread_id: item.detailId,
      })
      Object.assign(item, mergeAnnouncementDetail(item, detail, config.rocomApiBaseUrl))
    } catch (error) {
      warnings.push(`公告详情获取失败：${item.title}：${formatError(error)}`)
    }
  }
}

function mergeAnnouncementDetail(base: AnnouncementItem, detailValue: unknown, baseUrl: string): AnnouncementItem {
  const detailRecord = resolveDetailRecord(detailValue)
  const title = readFirstString(detailRecord, [
    'title',
    'name',
    'notice_title',
    'thread_title',
    'threadTitle',
    'subject',
  ])
  const summary = readAnnouncementSummary(detailRecord)
  const url = normalizeUrl(readFirstString(detailRecord, ['url', 'link', 'jump_url', 'jumpUrl', 'href']), baseUrl)
  const detailImages = collectImageUrls(detailRecord, baseUrl)
  const publishedAt = readTime(detailRecord, PUBLISH_TIME_KEYS)
  const startAt = readTime(detailRecord, START_TIME_KEYS)
  const endAt = readTime(detailRecord, END_TIME_KEYS)

  return {
    ...base,
    title: chooseLongerText(base.title, title) || base.title,
    summary: chooseLongerText(base.summary, summary),
    publishedAt: base.publishedAt || publishedAt,
    startAt: base.startAt || startAt,
    endAt: base.endAt || endAt,
    time: base.time
      || publishedAt
      || startAt
      || readTime(detailRecord, ['created_at', 'createdAt', 'updated_at', 'updatedAt', 'time', 'tt']),
    url: url || base.url,
    imageUrls: normalizeImageList([...(base.imageUrls || []), ...detailImages]),
    status: readFirstString(detailRecord, ['status', 'state', 'tag']) || base.status,
  }
}

function collectCandidateItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    const nested = value.flatMap(item => collectCandidateItems(item))
    return nested.length ? nested : value
  }

  const record = asRecord(value)
  if (!Object.keys(record).length) return []
  if (looksLikeItem(record)) return [record]

  const result: unknown[] = []
  for (const key of ['items', 'list', 'records', 'activities', 'otherActivities', 'announcements']) {
    const items = collectCandidateItems(record[key])
    if (items.length) result.push(...items)
  }

  if (result.length) {
    return result
  }

  return collectCandidateItems(record.data)
}

function resolveDetailRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  if (!Object.keys(record).length) return {}
  if (looksLikeItem(record) || looksLikeDetail(record)) return record

  for (const key of ['data', 'detail', 'announcement', 'thread', 'item', 'info', 'result']) {
    const nested = resolveDetailRecord(record[key])
    if (Object.keys(nested).length) return nested
  }

  const candidates = collectCandidateItems(value)
  return asRecord(candidates[0])
}

function looksLikeItem(record: Record<string, unknown>) {
  return Boolean(readFirstString(record, [
    'title',
    'name',
    'activity_name',
    'activityName',
    'notice_title',
    'subject',
  ]))
}

function looksLikeDetail(record: Record<string, unknown>) {
  return Boolean(
    readAnnouncementSummary(record)
    || collectImageUrls(record, '').length,
  )
}

function dedupeItems(items: AnnouncementItem[]) {
  const seen = new Set<string>()
  const result: AnnouncementItem[] = []
  for (const item of items) {
    const key = [
      item.type,
      item.id || item.title,
      item.publishedAt || '',
      item.startAt || '',
      item.endAt || '',
      item.time || '',
    ].join(':')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function prepareVisibleItems(items: AnnouncementItem[], now: number) {
  return items
    .map((item, index) => ({ item: markActivityUrgency(item, now), index }))
    .filter(({ item }) => !isExpiredActivity(item, now))
    .sort((left, right) => {
      if (left.item.urgent !== right.item.urgent) {
        return left.item.urgent ? -1 : 1
      }
      return left.index - right.index
    })
    .map(({ item }) => item)
}

function markActivityUrgency(item: AnnouncementItem, now: number): AnnouncementItem {
  if (item.type !== '活动') return item
  const remaining = item.endAt ? item.endAt - now : undefined
  const urgent = remaining !== undefined && remaining > 0 && remaining <= ACTIVITY_ENDING_SOON_THRESHOLD
  return { ...item, urgent }
}

function isExpiredActivity(item: AnnouncementItem, now: number) {
  return item.type === '活动' && Boolean(item.endAt && item.endAt <= now)
}

function readFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function readTime(record: Record<string, unknown>, keys: string[]) {
  return normalizeTime(readFirst(record, keys))
}

function normalizeTime(value: unknown) {
  const timestamp = normalizeTimestampMs(value)
  if (timestamp) return timestamp
  if (typeof value !== 'string') return undefined

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeDetailLimit(value: unknown) {
  const numberValue = Number(value ?? DEFAULT_DETAIL_LIMIT)
  if (!Number.isFinite(numberValue)) return DEFAULT_DETAIL_LIMIT
  return Math.max(0, Math.floor(numberValue))
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

function readAnnouncementSummary(record: Record<string, unknown>) {
  let summary = ''
  for (const value of collectAnnouncementTextValues(record)) {
    const cleaned = cleanSummary(value)
    if (cleaned) {
      summary = chooseLongerText(summary, cleaned) || summary
    }
  }
  return summary
}

function collectAnnouncementTextValues(record: Record<string, unknown>) {
  const values: string[] = []
  for (const key of SUMMARY_TEXT_KEYS) {
    const value = record[key]
    const text = readString(value)
    if (text) values.push(text)
    collectContentTextValues(value, values)
  }
  collectContentTextValues(record.content, values)
  return values
}

function collectContentTextValues(value: unknown, result: string[], depth = 0) {
  if (depth > 3 || value == null) return

  if (Array.isArray(value)) {
    value.forEach(item => collectContentTextValues(item, result, depth + 1))
    return
  }

  const text = readString(value)
  if (text) {
    result.push(text)
    return
  }

  const record = asRecord(value)
  if (!Object.keys(record).length) return

  for (const key of CONTENT_TEXT_KEYS) {
    const child = record[key]
    const childText = readString(child)
    if (childText) result.push(childText)
    collectContentTextValues(child, result, depth + 1)
  }
}

function cleanSummary(value: string) {
  if (!value) return ''

  return decodeHtmlEntities(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
}

function normalizeUrl(value: string, baseUrl: string) {
  if (!value) return undefined
  if (/^data:image\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  if (/^https?:\/\//i.test(value)) return value
  try {
    return new URL(value, baseUrl || 'https://wegame.shallow.ink').toString()
  } catch {
    return undefined
  }
}

function collectImageUrls(record: Record<string, unknown>, baseUrl: string) {
  const result = new Set<string>()
  collectImagesFromValue(record, baseUrl, result)
  return [...result]
}

function collectImagesFromValue(value: unknown, baseUrl: string, result: Set<string>, depth = 0) {
  if (depth > 4 || value == null) return

  if (Array.isArray(value)) {
    value.forEach(item => collectImagesFromValue(item, baseUrl, result, depth + 1))
    return
  }

  const text = readString(value)
  if (text) {
    extractImageUrlsFromText(text, baseUrl).forEach(url => result.add(url))
    return
  }

  const record = asRecord(value)
  if (!Object.keys(record).length) return

  for (const key of DIRECT_IMAGE_KEYS) {
    collectImageValue(record[key], baseUrl, result)
  }
  for (const key of IMAGE_LIST_KEYS) {
    collectImageValue(record[key], baseUrl, result)
  }
  for (const key of [...SUMMARY_TEXT_KEYS, ...CONTENT_TEXT_KEYS]) {
    const html = readString(record[key])
    if (html) {
      extractImageUrlsFromText(html, baseUrl).forEach(url => result.add(url))
    }
  }
  for (const key of MEDIA_CONTAINER_KEYS) {
    collectImagesFromValue(record[key], baseUrl, result, depth + 1)
  }
}

function collectImageValue(value: unknown, baseUrl: string, result: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach(item => collectImageValue(item, baseUrl, result))
    return
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const url = normalizeUrl(readString(value), baseUrl)
    if (url) result.add(url)
    return
  }

  const record = asRecord(value)
  for (const key of ['url', 'src', 'href', 'image', 'imageUrl', 'image_url', 'img', 'pic', 'cover', 'coverUrl', 'cover_url']) {
    const url = normalizeUrl(readString(record[key]), baseUrl)
    if (url) result.add(url)
  }
}

function extractImageUrlsFromText(text: string, baseUrl: string) {
  const urls = new Set<string>()
  for (const match of text.matchAll(/<img\b[^>]*?\bsrc=(["'])(.*?)\1/gi)) {
    const url = normalizeUrl(match[2], baseUrl)
    if (url) urls.add(url)
  }
  for (const match of text.matchAll(/<img\b[^>]*?\bdata-src=(["'])(.*?)\1/gi)) {
    const url = normalizeUrl(match[2], baseUrl)
    if (url) urls.add(url)
  }
  for (const match of text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    const url = normalizeUrl(match[1].trim(), baseUrl)
    if (url) urls.add(url)
  }
  return [...urls]
}

function normalizeImageList(values: string[]) {
  const result = Array.from(new Set(values.filter(Boolean)))
  return result.length ? result : undefined
}

function chooseLongerText(current?: string, next?: string) {
  if (!current) return next
  if (!next) return current
  return next.length > current.length ? next : current
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
