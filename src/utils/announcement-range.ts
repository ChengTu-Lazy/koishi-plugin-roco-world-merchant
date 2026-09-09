import { AnnouncementItem } from '../types'

export function filterRecentAnnouncements(items: AnnouncementItem[], days = 3, now = Date.now(), timezoneOffset = 8) {
  const recentDays = Number.isFinite(days) && days >= 0 ? Math.floor(days) : 3
  if (recentDays === 0) return items
  const day = 24 * 60 * 60 * 1000
  const offset = timezoneOffset * 60 * 60 * 1000
  const start = Math.floor((now + offset) / day) * day - offset - (recentDays - 1) * day
  return items.filter(item => {
    if (item.type !== '公告') return true
    const publishedAt = item.publishedAt || item.time
    return Number.isFinite(publishedAt) && publishedAt >= start && publishedAt <= now
  })
}
