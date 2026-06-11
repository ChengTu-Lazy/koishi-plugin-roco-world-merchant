const ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

export function decodeHtmlEntities(text: string) {
  return text.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, entity => ENTITY_MAP[entity] || entity)
}

export function stripTags(text: string) {
  return decodeHtmlEntities(text.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractAttr(attrs: string, name: string) {
  const doubleQuoted = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs)
  if (doubleQuoted?.[1]) return doubleQuoted[1].trim()

  const singleQuoted = new RegExp(`${name}='([^']*)'`, 'i').exec(attrs)
  return singleQuoted?.[1]?.trim() || ''
}

export function extractTextByPatterns(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match?.[1]) {
      return stripTags(match[1])
    }
  }
  return ''
}

export function extractEmTexts(text: string) {
  return Array.from(text.matchAll(/<em\b[^>]*>([\s\S]*?)<\/em>/gi))
    .map(match => stripTags(match[1] || ''))
    .filter(Boolean)
}

export function parseShowShopinfoArgs(attrs: string) {
  const match = /showShopinfo\(([\s\S]*?)\)/i.exec(attrs)
  if (!match) return [] as string[]

  return Array.from(match[1].matchAll(/'((?:\\'|[^'])*)'/g))
    .map(item => item[1].replace(/\\'/g, "'").trim())
}

export function normalizeUrl(url: string) {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  return url
}
