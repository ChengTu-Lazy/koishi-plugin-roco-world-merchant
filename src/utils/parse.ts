export function parseInteger(value: unknown) {
  if (value == null) return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

export function normalizeTimestampMs(value: unknown) {
  const timestamp = parseInteger(value)
  if (!timestamp || timestamp <= 0) return undefined
  return timestamp < 1e12 ? timestamp * 1000 : timestamp
}

export function parsePrice(priceText: string) {
  const text = priceText
    .toLowerCase()
    .replace(/洛克贝/g, '')
    .replace(/价格[:：]/g, '')
    .replace(/,/g, '')
    .trim()

  if (!text) return undefined

  let normalized = text
  let multiplier = 1
  if (normalized.endsWith('w') || normalized.endsWith('万')) {
    multiplier = 10000
    normalized = normalized.slice(0, -1)
  }

  const value = Number(normalized)
  if (!Number.isFinite(value)) return undefined
  return Math.round(value * multiplier)
}

export function parseLimit(limitText: string) {
  const match = /(\d+)/.exec(limitText)
  return match ? Number(match[1]) : undefined
}

export function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values.filter(value => Number.isInteger(value))))
}
