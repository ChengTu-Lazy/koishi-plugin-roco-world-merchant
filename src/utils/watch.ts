import { MerchantItem } from '../types'

export interface WatchMatch {
  matchedWatchItems: string[]
  matchedItemNames: string[]
}

export function findWatchMatch(items: MerchantItem[] | undefined, watchItems: string[]) {
  const normalizedWatchItems = normalizeWatchItems(watchItems)
  if (!normalizedWatchItems.length) {
    return null
  }

  const matchedWatchItems = new Set<string>()
  const matchedItemNames = new Set<string>()

  for (const item of Array.isArray(items) ? items : []) {
    const itemName = item.name?.trim()
    const normalizedItemName = normalizeName(itemName)
    if (!itemName || !normalizedItemName) {
      continue
    }

    for (const watchItem of normalizedWatchItems) {
      const normalizedWatchItem = normalizeName(watchItem)
      if (!normalizedWatchItem) {
        continue
      }

      if (normalizedItemName.includes(normalizedWatchItem) || normalizedWatchItem.includes(normalizedItemName)) {
        matchedWatchItems.add(watchItem)
        matchedItemNames.add(itemName)
      }
    }
  }

  if (!matchedItemNames.size) {
    return null
  }

  return {
    matchedWatchItems: [...matchedWatchItems],
    matchedItemNames: [...matchedItemNames],
  } satisfies WatchMatch
}

export function normalizeWatchItems(items: string[]) {
  const bucket = new Map<string, string>()
  for (const item of Array.isArray(items) ? items : []) {
    const trimmed = item?.trim()
    const normalized = normalizeName(trimmed)
    if (!trimmed || !normalized || bucket.has(normalized)) {
      continue
    }
    bucket.set(normalized, trimmed)
  }
  return [...bucket.values()]
}

export function buildWatchNotice(match: WatchMatch) {
  return `【关注物品命中】${match.matchedItemNames.join('、')}`
}

function normalizeName(value?: string) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '')
}
