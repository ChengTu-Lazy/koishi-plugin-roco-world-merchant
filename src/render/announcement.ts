import { AnnouncementData, AnnouncementItem, AnnouncementPushMode } from '../types'
import { formatDateTime } from '../utils/time'
import { SvgImage } from './image'

const WIDTH = 920
const PADDING = 32
const CARD_GAP = 16
const LINE_HEIGHT = 24
const TITLE_LINE_HEIGHT = 30
const IMAGE_WIDTH = 220
const IMAGE_HEIGHT = 124
const IMAGE_GAP = 10
const IMAGE_COLUMNS = 3
const FONT_FAMILY = 'Microsoft YaHei, Noto Sans CJK SC, PingFang SC, Arial, sans-serif'

interface AnnouncementCard {
  item?: AnnouncementItem
  titleLines: string[]
  meta: string[]
  summaryLines: string[]
  imageUrls: string[]
  urlLines: string[]
  height: number
}

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

  lines.push(`共获取 ${data.items.length} 条：`)
  lines.push(...data.items.map((item, index) => formatItem(item, index, timezoneOffset)))

  return lines.join('\n')
}

const MAX_PAGE_HEIGHT = 4400
// 截图倍率为 2：2200 逻辑像素对应最终图片的 4400 像素。
const MIN_LAST_PAGE_HEIGHT = 2200

function measureCard(card: AnnouncementCard) {
  return Math.max(96, 52 + card.titleLines.length * TITLE_LINE_HEIGHT
    + (card.meta.length ? LINE_HEIGHT : 0) + card.summaryLines.length * LINE_HEIGHT
    + (card.imageUrls.length ? Math.ceil(card.imageUrls.length / IMAGE_COLUMNS) * (IMAGE_HEIGHT + IMAGE_GAP) + 16 : 0)
    + card.urlLines.length * 21)
}

export function renderAnnouncementPages(data: AnnouncementData, timezoneOffset: number): SvgImage[] {
  const warningHeight = (data.warnings || []).flatMap(w => wrapText(`提示：${w}`, WIDTH - PADDING * 2, 15)).length * 22
  const capacity = Math.max(300, MAX_PAGE_HEIGHT - 204 - warningHeight)
  const parts: AnnouncementCard[] = []
  for (const item of data.items) {
    const original = buildCard(item, timezoneOffset)
    if (original.height <= capacity) { parts.push(original); continue }
    // 在文字行、图片行之间断开，续页保留标题和时间，素材指令只放最后一段。
    let current: AnnouncementCard = { ...original, summaryLines: [], imageUrls: [], urlLines: [] }
    const flush = () => {
      current.height = measureCard(current)
      parts.push(current)
      current = { ...original, titleLines: [...original.titleLines, '（续）'], summaryLines: [], imageUrls: [], urlLines: [] }
    }
    const add = (key: 'summaryLines' | 'imageUrls' | 'urlLines', values: string[]) => {
      const next = { ...current, [key]: [...current[key], ...values] }
      if (measureCard(next) > capacity && (current.summaryLines.length || current.imageUrls.length || current.urlLines.length)) flush()
      current[key] = [...current[key], ...values]
    }
    original.summaryLines.forEach(line => add('summaryLines', [line]))
    for (let i = 0; i < original.imageUrls.length; i += IMAGE_COLUMNS) add('imageUrls', original.imageUrls.slice(i, i + IMAGE_COLUMNS))
    original.urlLines.forEach(line => add('urlLines', [line]))
    flush()
  }
  if (!parts.length) return [renderAnnouncementSvgImage(data, timezoneOffset)]
  const pages: AnnouncementCard[][] = []
  let page: AnnouncementCard[] = []
  let used = 0
  for (const card of parts) {
    if (page.length && used + CARD_GAP + card.height > capacity) { pages.push(page); page = []; used = 0 }
    used += (page.length ? CARD_GAP : 0) + card.height
    page.push(card)
  }
  if (page.length) pages.push(page)
  if (pages.length > 1) {
    const last = pages[pages.length - 1]
    const lastHeight = renderAnnouncementSvgImage(data, timezoneOffset, last).height
    if (lastHeight < MIN_LAST_PAGE_HEIGHT) {
      pages[pages.length - 2].push(...last)
      pages.pop()
    }
  }
  return pages.map((cards, i) => renderAnnouncementSvgImage(data, timezoneOffset, cards, `${i + 1} / ${pages.length}`))
}

export function renderAnnouncementSvgImage(data: AnnouncementData, timezoneOffset: number, pageCards?: AnnouncementCard[], pageLabel?: string): SvgImage {
  const warningLines = (data.warnings || []).flatMap(warning => wrapText(`提示：${warning}`, WIDTH - PADDING * 2, 15))
  const headerHeight = 132 + warningLines.length * 22
  const cards: AnnouncementCard[] = pageCards || (data.items.length
    ? data.items.map(item => buildCard(item, timezoneOffset))
    : [{
      item: undefined,
      titleLines: ['本次未获取到公告/活动内容。'],
      meta: [],
      summaryLines: [],
      imageUrls: [],
      urlLines: [],
      height: 96,
    }])
  const contentHeight = cards.reduce((sum, card) => sum + card.height, 0) + Math.max(0, cards.length - 1) * CARD_GAP
  const footerHeight = 44
  const height = headerHeight + 28 + contentHeight + footerHeight
  const content: string[] = []

  content.push(`<defs>
  <linearGradient id="announcementHeader" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#183d36"/>
    <stop offset="100%" stop-color="#315a50"/>
  </linearGradient>
</defs>`)
  content.push(`<rect width="${WIDTH}" height="${height}" rx="28" fill="#f1f3ef"/>`)
  content.push(`<rect x="0" y="0" width="${WIDTH}" height="${headerHeight}" rx="28" fill="url(#announcementHeader)"/>`)
  content.push(svgText(PADDING, 48, `王国快讯 · ${formatMode(data.mode)}`, 30, '#ffffff', 700))
  content.push(svgText(PADDING, 82, `洛克王国：世界   ·   ${formatDateTime(data.fetchedAt, timezoneOffset)}`, 16, '#c5d8cf', 400))
  content.push(svgText(PADDING, 110, `共 ${data.items.length} 条   /   公告素材可通过「公告素材 ID」单独获取`, 15, '#dce8df', 400))

  warningLines.forEach((line, index) => {
    content.push(svgText(PADDING, 138 + index * 22, line, 15, '#ffe8b8', 500))
  })

  let y = headerHeight + 24
  cards.forEach((card) => {
    const urgent = Boolean(card.item?.urgent)
    const fill = urgent ? '#fffaf8' : '#ffffff'
    const stroke = urgent ? '#e8d3cb' : '#dfe5de'
    const titleFill = urgent ? '#b51f1f' : '#25342c'
    const metaFill = urgent ? '#b9352b' : '#6d725e'
    const titleWeight = urgent ? 800 : 600
    content.push(`<rect x="${PADDING}" y="${y}" width="${WIDTH - PADDING * 2}" height="${card.height}" rx="20" fill="${fill}" stroke="${stroke}" stroke-width="${urgent ? 2 : 1}"/>`)

    let textY = y + (card.height - getContentHeight(card)) / 2 + 22
    card.titleLines.forEach((line, lineIndex) => {
      content.push(svgText(PADDING + 28, textY + lineIndex * TITLE_LINE_HEIGHT, line, 22, titleFill, titleWeight))
    })
    textY += card.titleLines.length * TITLE_LINE_HEIGHT

    if (card.meta.length) {
      content.push(svgText(PADDING + 28, textY, card.meta.join('  |  '), 15, metaFill, urgent ? 800 : 500))
      textY += LINE_HEIGHT
    }

    card.summaryLines.forEach((line) => {
      content.push(svgText(PADDING + 28, textY, line, 16, '#3f4a42', 500))
      textY += LINE_HEIGHT
    })

    card.imageUrls.forEach((url, imageIndex) => {
      const column = imageIndex % IMAGE_COLUMNS
      const row = Math.floor(imageIndex / IMAGE_COLUMNS)
      const imageX = PADDING + 28 + column * (IMAGE_WIDTH + IMAGE_GAP)
      const imageY = textY + row * (IMAGE_HEIGHT + IMAGE_GAP)
      content.push(`<rect x="${imageX}" y="${imageY}" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" rx="14" fill="#efe6d3" stroke="#d8c6a8"/>`)
      content.push(`<image x="${imageX}" y="${imageY}" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(url)}"/>`)
    })
    if (card.imageUrls.length) {
      textY += Math.ceil(card.imageUrls.length / IMAGE_COLUMNS) * (IMAGE_HEIGHT + IMAGE_GAP) + 16
    }

    card.urlLines.forEach((line) => {
      content.push(svgText(PADDING + 28, textY, line, 14, '#8a6331', 500))
      textY += 21
    })

    y += card.height + CARD_GAP
  })

  content.push(svgText(PADDING, height - 18, `ROCO WORLD   /   王国情报站${pageLabel ? `   ·   ${pageLabel}` : ''}`, 13, '#87938b', 400))

  return {
    width: WIDTH,
    height,
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
${content.join('\n')}
</svg>`,
  }
}

// 文本坐标为基线，图片坐标为顶边；扣除最后一行的行距才能对齐实际内容。
function getContentHeight(card: AnnouncementCard) {
  let bottom = card.titleLines.length * TITLE_LINE_HEIGHT
    + (card.meta.length ? LINE_HEIGHT : 0)
    + card.summaryLines.length * LINE_HEIGHT
    + (card.imageUrls.length ? Math.ceil(card.imageUrls.length / IMAGE_COLUMNS) * (IMAGE_HEIGHT + IMAGE_GAP) + 16 : 0)
    + card.urlLines.length * 21
  if (card.urlLines.length) bottom -= 17
  else if (card.imageUrls.length) bottom -= IMAGE_GAP + 16
  else if (card.summaryLines.length || card.meta.length) bottom -= LINE_HEIGHT - 4
  else bottom -= TITLE_LINE_HEIGHT - 5
  return bottom + 22
}

function formatItem(item: AnnouncementItem, index: number, timezoneOffset: number) {
  const parts = [
    `${index + 1}. ${formatTitle(item)}`,
    ...formatMeta(item, timezoneOffset),
    item.status ? `状态：${item.status}` : '',
  ].filter(Boolean)

  const lines = [parts.join(' | ')]
  if (item.summary) {
    lines.push(`   ${item.summary}`)
  }
  if (item.imageUrls?.length) {
    item.imageUrls.forEach(url => lines.push(`   图片：${url}`))
  }
  if (item.url) {
    lines.push(`   ${item.url}`)
  }
  return lines.join('\n')
}

function formatMode(mode: AnnouncementPushMode) {
  if (mode === 'activities') return '活动信息'
  if (mode === 'announcement') return '近期公告（最多10条）'
  return '近期公告（最多10条）+ 活动信息'
}

function buildCard(item: AnnouncementItem, timezoneOffset: number) {
  const titleLines = wrapText(item.title, WIDTH - PADDING * 2 - 56, 22)
  const meta = [
    ...formatMeta(item, timezoneOffset),
    item.type === '活动' && !item.urgent && item.endAt ? `剩余：${formatRemaining(item.endAt - Date.now())}` : '',
  ].filter(Boolean)
  const summaryLines = item.summary
    ? wrapText(item.summary, WIDTH - PADDING * 2 - 56, 16)
    : []
  const imageUrls = item.imageUrls || []
  const imageRows = Math.ceil(imageUrls.length / IMAGE_COLUMNS)
  const urlLines = item.type === '公告' && item.id
    ? [`获取完整素材 → 公告素材 ${item.id}`]
    : []
  const height = Math.max(
    96,
    28
      + titleLines.length * TITLE_LINE_HEIGHT
      + (meta.length ? LINE_HEIGHT : 0)
      + summaryLines.length * LINE_HEIGHT
      + (imageRows ? imageRows * (IMAGE_HEIGHT + IMAGE_GAP) + 16 : 0)
      + urlLines.length * 21
      + 24,
  )

  return {
    item,
    titleLines,
    meta,
    summaryLines,
    imageUrls,
    urlLines,
    height,
  }
}

function formatTitleLabel(item: AnnouncementItem) {
  if (item.urgent) return '【快过期活动】'
  return `【${item.type}】`
}

function formatTitle(item: AnnouncementItem) {
  return `${formatTitleLabel(item)}${item.title}${formatActivityTitleCountdown(item)}`
}

function formatActivityTitleCountdown(item: AnnouncementItem) {
  if (item.type !== '活动' || !item.endAt) return ''

  const remainingText = formatRemaining(item.endAt - Date.now())
  if (!remainingText) return ''
  return item.urgent
    ? `（最后冲刺，只剩 ${remainingText}）`
    : `（距离结束还有 ${remainingText}）`
}

function formatMeta(item: AnnouncementItem, timezoneOffset: number) {
  if (item.type === '公告') {
    const publishedAt = item.publishedAt || item.time
    return [publishedAt ? `发布日期：${formatDateTime(publishedAt, timezoneOffset)}` : '', item.id ? `ID：${item.id}` : ''].filter(Boolean)
  }

  const meta = [
    item.startAt ? `开始：${formatDateTime(item.startAt, timezoneOffset)}` : '',
    item.endAt ? `结束：${formatDateTime(item.endAt, timezoneOffset)}` : '',
    item.urgent && item.endAt ? `剩余：${formatRemaining(item.endAt - Date.now())}` : '',
  ].filter(Boolean)
  return meta
}

function formatRemaining(remainingMs: number) {
  const safeMs = Math.max(0, remainingMs)
  const totalHours = Math.ceil(safeMs / 60 / 60 / 1000)
  if (totalHours <= 0) return ''
  if (totalHours <= 24) return `${totalHours} 小时内`
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours ? `${days} 天 ${hours} 小时` : `${days} 天`
}

function wrapText(text: string, maxWidth: number, fontSize: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const lines: string[] = []
  let current = ''
  let width = 0
  for (const char of Array.from(normalized)) {
    const charWidth = getCharWidth(char, fontSize)
    if (current && width + charWidth > maxWidth) {
      lines.push(current)
      current = char
      width = charWidth
      continue
    }

    current += char
    width += charWidth
  }

  if (current) lines.push(current)
  return lines
}

function getCharWidth(char: string, fontSize: number) {
  if (/\s/.test(char)) return fontSize * 0.35
  if (/[\x00-\x7f]/.test(char)) return fontSize * 0.58
  return fontSize
}

function svgText(
  x: number,
  y: number,
  text: string,
  fontSize: number,
  fill: string,
  fontWeight = 500,
  anchor: 'start' | 'middle' = 'start',
) {
  return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="${FONT_FAMILY}" fill="${fill}" font-weight="${fontWeight}" text-anchor="${anchor}">${escapeXml(text)}</text>`
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
