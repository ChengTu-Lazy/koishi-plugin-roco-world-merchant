import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Logger } from 'koishi'

import { CACHE_DATA_VERSION, IMAGE_RENDER_VERSION, MINUTE } from './constants'
import { CacheEntry, MerchantData, MerchantItem, PersistedState, ScheduleTime, SourceName } from './types'
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
  if (!isCompatibleCache(entry)) return null
  if (entry.expiresAt <= Date.now()) return null
  return entry
}

export function isCompatibleCache(entry: CacheEntry | undefined) {
  return entry?.dataVersion === CACHE_DATA_VERSION
}

export function createCacheEntry(
  data: MerchantData,
  source: SourceName,
  previous: CacheEntry | undefined,
  scheduleTimes: ScheduleTime[],
  timezoneOffset: number,
) {
  const now = Date.now()
  const items = Array.isArray(data.items) ? data.items : []
  const roundStartTime = normalizeTimestampMs(data.round?.start_time)
  const roundEndTime = normalizeTimestampMs(data.round?.end_time)
  const startTimes = roundStartTime
    ? [roundStartTime]
    : items
      .map(item => normalizeTimestampMs(item.start_time))
      .filter((value): value is number => Boolean(value))
  const endTimes = roundEndTime
    ? [roundEndTime]
    : items
      .map(item => normalizeTimestampMs(item.end_time))
      .filter((value): value is number => Boolean(value))

  const slotKey = startTimes.length && endTimes.length
    ? `${Math.min(...startTimes)}-${Math.max(...endTimes)}`
    : `${source}-${data.subtitle || formatDateOnly(now, timezoneOffset)}-round-${data.round?.current ?? 'unknown'}`

  const fallbackExpiry = getNextScheduleTime(new Date(now), scheduleTimes, timezoneOffset).getTime()
  const expiresAt = endTimes.length
    ? Math.max(now + MINUTE, Math.max(...endTimes))
    : fallbackExpiry

  const sameSlot = previous?.slotKey === slotKey
  const canReuseImage = sameSlot
    && getMerchantDataSignature(previous?.data) === getMerchantDataSignature(data)
    && previous?.imageVersion === IMAGE_RENDER_VERSION
    && previous?.imageMimeType === 'image/png'
    && isPngBase64(previous?.imageBase64)
  return {
    dataVersion: CACHE_DATA_VERSION,
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

function getMerchantDataSignature(data: MerchantData | undefined) {
  const items = Array.isArray(data?.items) ? data.items : []
  return JSON.stringify({
    merchant_name: data?.merchant_name || '',
    subtitle: data?.subtitle || '',
    round_label: data?.round?.label || '',
    round_start_time: data?.round?.start_time || '',
    round_end_time: data?.round?.end_time || '',
    items: items.map(getMerchantItemSignature),
  })
}

function getMerchantItemSignature(item: MerchantItem) {
  return {
    name: item.name || '',
    kind: item.kind || '',
    image: item.image || '',
    start_time: item.start_time || '',
    end_time: item.end_time || '',
    time_label: item.time_label || '',
    price: item.price ?? '',
    limit: item.limit ?? '',
    status: item.status || '',
  }
}
