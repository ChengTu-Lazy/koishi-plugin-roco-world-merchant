import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Logger } from 'koishi'

import { IMAGE_RENDER_VERSION, MINUTE } from './constants'
import { CacheEntry, MerchantData, PersistedState, SourceName } from './types'
import { formatDateOnly, getNextScheduleTime } from './utils/time'
import { formatError } from './utils/error'
import { isPngBase64 } from './utils/image'
import { normalizeTimestampMs } from './utils/parse'

export async function loadState(file: string, logger: Logger) {
  try {
    const content = await readFile(file, 'utf8')
    return JSON.parse(content) as PersistedState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`读取缓存文件失败：${formatError(error)}`)
    }
    return {}
  }
}

export async function persistState(file: string, state: PersistedState) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

export function getUsableCache(state: PersistedState) {
  const entry = state.cache
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) return null
  return entry
}

export function createCacheEntry(
  data: MerchantData,
  source: SourceName,
  previous: CacheEntry | undefined,
  scheduleHours: number[],
  timezoneOffset: number,
) {
  const now = Date.now()
  const items = Array.isArray(data.items) ? data.items : []
  const startTimes = items
    .map(item => normalizeTimestampMs(item.start_time))
    .filter((value): value is number => Boolean(value))
  const endTimes = items
    .map(item => normalizeTimestampMs(item.end_time))
    .filter((value): value is number => Boolean(value))

  const slotKey = startTimes.length && endTimes.length
    ? `${Math.min(...startTimes)}-${Math.max(...endTimes)}`
    : `${source}-${data.subtitle || formatDateOnly(now, timezoneOffset)}-round-${data.round?.current ?? 'unknown'}`

  const fallbackExpiry = getNextScheduleTime(new Date(now), scheduleHours, timezoneOffset).getTime()
  const expiresAt = endTimes.length
    ? Math.max(now + MINUTE, Math.max(...endTimes))
    : fallbackExpiry

  const sameSlot = previous?.slotKey === slotKey
  const canReuseImage = sameSlot
    && previous?.imageVersion === IMAGE_RENDER_VERSION
    && previous?.imageMimeType === 'image/png'
    && isPngBase64(previous?.imageBase64)
  return {
    slotKey,
    expiresAt,
    fetchedAt: now,
    source,
    data,
    imageBase64: canReuseImage ? previous?.imageBase64 : undefined,
    imageMimeType: canReuseImage ? previous?.imageMimeType : undefined,
    imageVersion: canReuseImage ? previous?.imageVersion : undefined,
  } satisfies CacheEntry
}
