require('esbuild-register')
const assert = require('node:assert/strict')
const { filterRecentAnnouncements } = require('../src/utils/announcement-range.ts')
const now = Date.parse('2026-09-09T04:00:00Z')
const item = (title, date, type = '公告') => ({ title, type, publishedAt: date && Date.parse(date) })
const items = [
  item('今天', '2026-09-08T16:00:00Z'),
  item('昨天', '2026-09-08T15:59:59Z'),
  item('三天边界', '2026-09-06T16:00:00Z'),
  item('过期', '2026-09-06T15:59:59Z'),
  item('未来', '2026-09-10T00:00:00Z'),
  item('无时间'),
  item('活动', undefined, '活动'),
]
const titles = (days, offset = 8) => filterRecentAnnouncements(items, days, now, offset).map(x => x.title)
assert.deepEqual(titles(1), ['今天', '活动'])
assert.deepEqual(titles(3), ['今天', '昨天', '三天边界', '活动'])
assert.deepEqual(titles(1, 0), ['活动'])
assert.equal(filterRecentAnnouncements(items, 0, now), items)
assert.deepEqual(titles(undefined), titles(3))
assert.deepEqual(titles(-1), titles(3))
assert.deepEqual(titles(NaN), titles(3))
assert.equal(filterRecentAnnouncements([{ type: '公告', time: now }], 1, now).length, 1)
assert.equal(filterRecentAnnouncements([], 1, now).length, 0)
console.log('公告范围测试通过：自然日边界、时区、不限、无时间、未来时间、活动保留、时间回退和空列表')
