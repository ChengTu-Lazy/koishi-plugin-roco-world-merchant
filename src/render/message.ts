import { h } from 'koishi'

import { CacheEntry, CacheResult, OutputMode, SourceName } from '../types'
import { formatDateTime } from '../utils/time'

export function buildText(entry: CacheEntry, origin: CacheResult['origin'], warning: string | undefined, timezoneOffset: number) {
  const data = entry.data
  const items = Array.isArray(data.items) ? data.items : []
  const lines: string[] = []

  lines.push(`【${data.merchant_name || '远行商人'}】${data.subtitle || ''}`.trim())
  lines.push(`来源：${formatOrigin(origin)} | 数据源：${formatSource(entry.source)}`)

  if (data.round) {
    const roundParts = [
      data.round.label || (typeof data.round.current === 'number' ? `第${data.round.current}轮` : ''),
      data.round.status ? `状态：${data.round.status}` : '',
      data.round.countdown ? `倒计时：${data.round.countdown}` : '',
    ].filter(Boolean)

    if (roundParts.length) {
      lines.push(roundParts.join(' | '))
    }
  }

  lines.push(`抓取时间：${formatDateTime(entry.fetchedAt, timezoneOffset)}`)
  lines.push(`缓存有效至：${formatDateTime(entry.expiresAt, timezoneOffset)}`)

  if (warning) {
    lines.push(warning)
  }

  if (!items.length) {
    lines.push('当前未解析到商品数据。')
    return lines.join('\n')
  }

  lines.push(`商品数量：${typeof data.item_count === 'number' ? data.item_count : items.length}`)

  items.forEach((item, index) => {
    const itemParts = [
      `${index + 1}. ${item.name || '未知商品'}`,
      item.kind ? `类型：${item.kind}` : '',
      typeof item.price === 'number' ? `价格：${item.price.toLocaleString('zh-CN')}` : '',
      typeof item.limit === 'number' ? `限购：${item.limit}` : '',
      item.time_label ? `时段：${item.time_label}` : '',
      item.countdown ? `剩余：${item.countdown}` : '',
      item.status ? `状态：${item.status}` : '',
    ].filter(Boolean)

    lines.push(itemParts.join(' | '))
  })

  return lines.join('\n')
}

export function buildMessage(
  entry: CacheEntry,
  origin: CacheResult['origin'],
  warning: string | undefined,
  timezoneOffset: number,
  outputMode: OutputMode,
) {
  const text = buildText(entry, origin, warning, timezoneOffset)
  const imageTag = entry.imageBase64
    ? h.image(Buffer.from(entry.imageBase64, 'base64'), entry.imageMimeType || 'image/png').toString()
    : ''

  if (outputMode === 'text') {
    return text
  }

  if (outputMode === 'image') {
    return imageTag || text
  }

  return imageTag ? `${text}\n${imageTag}` : text
}

function formatOrigin(origin: CacheResult['origin']) {
  if (origin === 'cache') return '当前轮次缓存'
  if (origin === 'stale') return '旧缓存回退'
  return '实时请求'
}

function formatSource(source: SourceName) {
  if (source === 'onebiji') return 'onebiji 页面源'
  if (source === 'arkmeng') return '洛克万事屋'
  if (source === 'magicbook') return '洛克魔法书'
  return '咸鱼备用源'
}
