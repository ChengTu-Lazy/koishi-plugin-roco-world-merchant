import { Context } from 'koishi'

import { callRocomApi } from './rocom-api'
import { AnnouncementData, AnnouncementItem, AnnouncementPushMode, Config } from '../types'
import { formatError } from '../utils/error'
import { normalizeTimestampMs } from '../utils/parse'

const LATEST_ANNOUNCEMENT_PATH = '/api/v1/games/rocom/announcement/latest'
const ACTIVITIES_INFO_PATH = '/api/v1/games/rocom/activities/info'

export async function fetchAnnouncementData(
  ctx: Context,
  config: Config,
  mode: AnnouncementPushMode,
): Promise<AnnouncementData> {
  const items: AnnouncementItem[] = []
  const warnings: string[] = []

  if (mode === 'announcement' || mode === 'both') {
    try {
      const data = await callRocomApi(ctx, config, LATEST_ANNOUNCEMENT_PATH)
      items.push(...normalizeItems(data, '公告'))
    } catch (error) {
      warnings.push(`最新公告获取失败：${formatError(error)}`)
    }
  }

  if (mode === 'activities' || mode === 'both') {
    try {
      const data = await callRocomApi(ctx, config, ACTIVITIES_INFO_PATH)
      items.push(...normalizeItems(data, '活动'))
    } catch (error) {
      warnings.push(`活动信息获取失败：${formatError(error)}`)
    }
  }

  if (!items.length && warnings.length) {
    throw new Error(warnings.join('；'))
  }

  return {
    fetchedAt: Date.now(),
    mode,
    items: dedupeItems(items),
    warnings: warnings.length ? warnings : undefined,
  }
}

function normalizeItems(value: unknown, type: AnnouncementItem['type']) {
  return collectCandidateItems(value)
    .map(item => normalizeItem(asRecord(item), type))
    .filter((item): item is AnnouncementItem => Boolean(item))
}

function normalizeItem(record: Record<string, unknown>, type: AnnouncementItem['type']): AnnouncementItem | null {
  const title = readFirstString(record, [
    'title',
    'name',
    'activity_name',
    'activityName',
    'notice_title',
    'subject',
  ])
  if (!title) return null

  return {
    type,
    id: readFirstString(record, ['id', 'activity_id', 'activityId', 'notice_id', 'noticeId']),
    title,
    summary: cleanSummary(readFirstString(record, [
      'summary',
      'desc',
      'description',
      'content',
      'detail',
      'intro',
      'remark',
    ])),
    time: normalizeTime(readFirst(record, [
      'publish_time',
      'publishTime',
      'start_time',
      'startTime',
      'created_at',
      'createdAt',
      'updated_at',
      'updatedAt',
      'time',
      'tt',
    ])),
    url: normalizeUrl(readFirstString(record, ['url', 'link', 'jump_url', 'jumpUrl', 'href'])),
    status: readFirstString(record, ['status', 'state', 'tag']),
  }
}

function collectCandidateItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value

  const record = asRecord(value)
  if (!Object.keys(record).length) return []
  if (looksLikeItem(record)) return [record]

  for (const key of ['items', 'list', 'records', 'activities', 'otherActivities', 'announcements']) {
    const items = collectCandidateItems(record[key])
    if (items.length) return items
  }

  return collectCandidateItems(record.data)
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

function dedupeItems(items: AnnouncementItem[]) {
  const seen = new Set<string>()
  const result: AnnouncementItem[] = []
  for (const item of items) {
    const key = `${item.type}:${item.id || item.title}:${item.time || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function readFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function normalizeTime(value: unknown) {
  const timestamp = normalizeTimestampMs(value)
  if (timestamp) return timestamp
  if (typeof value !== 'string') return undefined

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
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

function cleanSummary(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(value: string) {
  if (!value) return undefined
  if (/^https?:\/\//i.test(value)) return value
  return undefined
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
