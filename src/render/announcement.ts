import { AnnouncementData, AnnouncementItem, AnnouncementPushMode } from '../types'
import { formatDateTime } from '../utils/time'

const MAX_ITEMS = 8
const MAX_SUMMARY_LENGTH = 80

export function buildAnnouncementMessage(data: AnnouncementData, timezoneOffset: number) {
  const lines = [
    `【洛克公告/活动】${formatMode(data.mode)}`,
    `抓取时间：${formatDateTime(data.fetchedAt, timezoneOffset)}`,
  ]

  if (data.warnings?.length) {
    lines.push(...data.warnings.map(warning => `提示：${warning}`))
  }

  if (!data.items.length) {
    lines.push('本次未获取到公告/活动内容。')
    return lines.join('\n')
  }

  lines.push(`共获取 ${data.items.length} 条，展示前 ${Math.min(data.items.length, MAX_ITEMS)} 条：`)
  lines.push(...data.items.slice(0, MAX_ITEMS).map((item, index) => formatItem(item, index, timezoneOffset)))

  if (data.items.length > MAX_ITEMS) {
    lines.push(`…还有 ${data.items.length - MAX_ITEMS} 条未展示`)
  }

  return lines.join('\n')
}

function formatItem(item: AnnouncementItem, index: number, timezoneOffset: number) {
  const parts = [
    `${index + 1}. 【${item.type}】${item.title}`,
    item.time ? formatDateTime(item.time, timezoneOffset) : '',
    item.status ? `状态：${item.status}` : '',
  ].filter(Boolean)

  const lines = [parts.join(' | ')]
  if (item.summary) {
    lines.push(`   ${truncate(item.summary, MAX_SUMMARY_LENGTH)}`)
  }
  if (item.url) {
    lines.push(`   ${item.url}`)
  }
  return lines.join('\n')
}

function formatMode(mode: AnnouncementPushMode) {
  if (mode === 'activities') return '活动信息'
  if (mode === 'announcement') return '最新公告'
  return '最新公告 + 活动信息'
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
