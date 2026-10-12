import { EggCard, EggResult, EggSection } from '../services/egg-query'
import { SvgImage } from './image'

export function eggResultText(result: EggResult) {
  return [`【${result.title}】`, ...result.lines].join('\n')
}

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
}

function renderTextPages(result: EggResult): SvgImage[] {
  const lines = result.lines.flatMap(line => {
    const output: string[] = []
    let current = '', width = 0
    for (const char of String(line)) {
      const size = char.charCodeAt(0) > 255 ? 2 : 1
      if (width + size > 76) { output.push(current); current = ''; width = 0 }
      current += char
      width += size
    }
    output.push(current)
    return output
  })
  const pages: SvgImage[] = []
  const count = Math.max(1, Math.ceil(lines.length / 32))
  for (let page = 0; page < count; page++) {
    const chunk = lines.slice(page * 32, (page + 1) * 32)
    const height = 140 + chunk.length * 32
    pages.push({ width: 900, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}">
      <rect width="900" height="${height}" rx="24" fill="#f6f1df"/>
      <g font-family="Microsoft YaHei, Arial" fill="#2f392f">
      <text x="32" y="48" font-size="28" font-weight="700">${escapeXml(result.title.slice(0, 28))}</text>
      ${chunk.map((line, index) => `<text x="32" y="${92 + index * 32}" font-size="20">${escapeXml(line)}</text>`).join('')}
      <text x="32" y="${height - 20}" font-size="16" fill="#687868">查蛋 · ${page + 1}/${count}</text></g></svg>` })
  }
  return pages
}

const palette = { ink: '#253c36', muted: '#74847d', green: '#257c61', border: '#e0e9df' }

function text(x: number, y: number, value: string, size = 20, color = palette.ink, bold = false) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${bold ? ' font-weight="700"' : ''}>${escapeXml(value)}</text>`
}

function shorten(value: string, max: number) {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : value
}

function icon(pet: EggCard, x: number, y: number, size: number) {
  const image = pet.icon ? `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${escapeXml(pet.icon)}" preserveAspectRatio="xMidYMid meet"/>` : ''
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="18" fill="#edf3e9"/>${text(x + size / 2 - 13, y + size / 2 + 10, pet.name.slice(0, 1), 28, '#a4b4a3', true)}${image}`
}

function rangeTile(x: number, y: number, width: number, label: string, value: string, fontSize = 18) {
  return `<rect x="${x}" y="${y}" width="${width}" height="60" rx="12" fill="#f3f6ef"/>${text(x + 12, y + 21, label, 14, palette.muted)}${text(x + 12, y + 46, shorten(value, 22), fontSize, palette.ink, true)}`
}

function card(pet: EggCard, x: number, y: number, rank: number) {
  const width = 412
  const score = pet.score == null ? undefined : Number(pet.score.toFixed(1))
  const scoreColor = pet.matchLabel === '范围匹配' ? '#b67b30' : palette.green
  const scoreText = score == null ? '' : `${score}%`
  const bar = score == null ? '' : `<rect x="${x + 100}" y="${y + 69}" width="290" height="5" rx="2.5" fill="#e7ede4"/><rect x="${x + 100}" y="${y + 69}" width="${290 * Math.max(0, Math.min(100, score)) / 100}" height="5" rx="2.5" fill="${scoreColor}"/>`
  const badge = pet.sizeClass ? `<rect x="${x + 310}" y="${y + 176}" width="82" height="23" rx="11" fill="#fff0d2"/>${text(x + 323, y + 192, pet.sizeClass, 14, '#9b6b21', true)}` : ''
  return `<rect x="${x}" y="${y}" width="${width}" height="214" rx="20" fill="#ffffff" stroke="${palette.border}"/>
    ${icon(pet, x + 16, y + 16, 70)}
    ${text(x + 100, y + 35, shorten(pet.name, score == null ? 12 : 9), 23, palette.ink, true)}
    ${text(x + 100, y + 57, `#${pet.id} · ${shorten(pet.type || '精灵', 13)}`, 14, palette.muted)}
    <text x="${x + 392}" y="${y + 34}" text-anchor="end" font-size="26" fill="${scoreColor}" font-weight="700">${escapeXml(scoreText)}</text>
    ${score == null ? '' : text(x + (pet.scoreLabel ? 337 : 349), y + 55, pet.scoreLabel || '匹配度', 12, palette.muted)}
    ${bar}
    ${rangeTile(x + 16, y + 99, 182, pet.confidence ? '尺寸匹配度' : '蛋身高 · m', pet.confidence ? (pet.fitScore == null ? '未提供' : `${pet.fitScore}%`) : pet.height.replace(/m$/, ''))}
    ${rangeTile(x + 212, y + 99, 184, pet.confidence ? '置信度' : '蛋体重 · kg', pet.confidence || pet.weight.replace(/kg$/, ''))}
    ${text(x + 16, y + 192, shorten(pet.groups || pet.matchLabel || '尺寸命中', pet.sizeClass ? 20 : 29), 14, palette.muted)}
    ${badge}
    <circle cx="${x + 23}" cy="${y + 23}" r="12" fill="${palette.green}"/>${text(x + (rank < 10 ? 19 : 15), y + 28, String(rank), 12, '#ffffff', true)} `
}

function compactCard(pet: EggCard, x: number, y: number, width: number, height: number, rank: number) {
  const score = pet.score == null ? undefined : Number(pet.score.toFixed(1))
  const scoreText = score == null ? '' : `${score}%`
  const iconSize = Math.min(64, width - 28)
  const barWidth = Math.max(40, width - 28)
  const titleMax = width >= 300 ? 11 : width >= 250 ? 9 : 7
  const typeMax = width >= 300 ? 15 : 10
  const bar = score == null ? '' : `<rect x="${x + 14}" y="${y + 100}" width="${barWidth}" height="5" rx="2.5" fill="#e7ede4"/><rect x="${x + 14}" y="${y + 100}" width="${barWidth * Math.max(0, Math.min(100, score)) / 100}" height="5" rx="2.5" fill="${palette.green}"/>`
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="#ffffff" stroke="${palette.border}"/>
    ${icon(pet, x + 14, y + 14, iconSize)}
    ${text(x + 14, y + iconSize + 38, shorten(pet.name, titleMax), width >= 300 ? 19 : 16, palette.ink, true)}
    ${text(x + 14, y + iconSize + 59, `#${pet.id} · ${shorten(pet.type || '精灵', typeMax)}`, 12, palette.muted)}
    <text x="${x + width - 14}" y="${y + 34}" text-anchor="end" font-size="${width >= 300 ? 23 : 19}" fill="${palette.green}" font-weight="700">${escapeXml(scoreText)}</text>
    ${score == null ? '' : text(x + width - 14, y + 53, pet.scoreLabel || '参考概率', 11, palette.muted)}
    ${bar}
    ${text(x + 14, y + height - 20, shorten(pet.matchLabel || '尺寸命中', width >= 300 ? 13 : 9), 12, palette.muted)}
    <circle cx="${x + 25}" cy="${y + 25}" r="11" fill="${palette.green}"/>${text(x + (rank < 10 ? 21 : 17), y + 29, String(rank), 11, '#ffffff', true)}`
}

function queryHeader(result: EggResult) {
  if (!result.query) return ''
  const metric = (x: number, label: string, value: number | undefined, unit: string) => `<rect x="${x}" y="95" width="402" height="100" rx="20" fill="#ffffff" stroke="${palette.border}"/>${text(x + 22, 123, label, 16, palette.muted)}${text(x + 22, 169, value == null ? '未指定' : String(value), 38, palette.ink, true)}${value == null ? '' : `<text x="${x + 377}" y="169" text-anchor="end" font-size="20" fill="${palette.muted}">${unit}</text>`}`
  return metric(32, '你输入的蛋身高', result.query.height, 'm') + metric(466, '你输入的蛋体重', result.query.weight, 'kg')
}

function petHeader(pet: EggCard) {
  return `<rect x="32" y="95" width="836" height="222" rx="22" fill="#ffffff" stroke="${palette.border}"/>
    ${icon(pet, 54, 114, 104)}
    ${text(180, 147, shorten(pet.name, 22), 32, palette.ink, true)}
    ${text(180, 178, `#${pet.id} · ${pet.type || '精灵'} · ${pet.groups || '暂无蛋组数据'}`, 18, palette.muted)}
    ${text(180, 207, `孵化时长：${pet.hatch || '接口未提供'}${pet.familyBase ? ` · 家族最低阶：${pet.familyBase}` : ''}`, 16, palette.muted)}
    ${rangeTile(54, 235, 380, '蛋身高 · m', pet.height.replace(/m$/, ''), 26)}
    ${rangeTile(454, 235, 392, '蛋体重 · kg', pet.weight.replace(/kg$/, ''), 26)}`
}

export function renderEggPages(result: EggResult): SvgImage[] {
  if (!result.sections && !result.pet && !result.query) return renderTextPages(result)
  // 候选较少时保持大卡片；候选增多时提高列数，减少分页和纵向滚动。
  const totalCards = (result.sections || []).reduce((sum, section) => sum + section.cards.length, 0)
  const columns = totalCards <= 8 ? 2 : totalCards <= 14 ? 3 : totalCards <= 20 ? 4 : 5
  const canvasWidth = columns === 2 ? 900 : columns * 280 + 40
  const gap = columns === 2 ? 12 : 12
  const cardWidth = (canvasWidth - 64 - (columns - 1) * gap) / columns
  const cardHeight = columns === 2 ? 214 : 188
  const perPage = columns * 5
  const chunks: { section: EggSection; cards: EggCard[]; start: number }[] = []
  for (const section of result.sections || []) {
    for (let start = 0; start < section.cards.length; start += perPage) chunks.push({ section, cards: section.cards.slice(start, start + perPage), start })
  }
  if (!chunks.length) chunks.push({ section: { title: result.pet ? '暂无可配种精灵' : '未找到匹配精灵', total: 0, cards: [] }, cards: [], start: 0 })
  return chunks.map(({ section, cards, start }, page) => {
    const sectionY = result.pet ? 360 : result.query ? 240 : 120
    const gridY = sectionY + 26
    const height = gridY + Math.max(1, Math.ceil(cards.length / columns)) * (cardHeight + 16) + 95
    const notice = section.cards.length < section.total ? `已展示 ${section.cards.length} / ${section.total} 只` : `${section.total} 只候选`
    const empty = cards.length ? '' : text(80, gridY + 85, result.pet ? (result.pet.groups?.includes('未发现') ? '未发现蛋组，不能配种。' : '接口未提供可配种精灵。') : '没有符合当前尺寸的精灵，试试核对输入数字。', 21, palette.muted)
    return { width: canvasWidth, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${height}" viewBox="0 0 ${canvasWidth} ${height}">
      <rect width="${canvasWidth}" height="${height}" rx="26" fill="#f2f5eb"/>
      <g font-family="Microsoft YaHei, Arial, sans-serif">
      ${text(32, 48, result.pet ? '精灵蛋组档案' : result.query ? '查蛋 · 精灵尺寸反查' : '查蛋 · 精灵名称候选', 29, palette.ink, true)}
      ${text(32, 74, 'ROCO WORLD  /  EGG LOOKUP', 12, palette.muted)}
      <text x="${canvasWidth - 32}" y="48" text-anchor="end" font-size="15" fill="${palette.muted}">${page + 1} / ${chunks.length}</text>
      ${queryHeader(result)}${result.pet ? petHeader(result.pet) : ''}
      ${text(32, sectionY, section.title, 23, palette.green, true)}
      <text x="${canvasWidth - 32}" y="${sectionY}" text-anchor="end" font-size="16" fill="${palette.muted}">${escapeXml(notice)}</text>
      ${cards.map((pet, index) => columns === 2
        ? card(pet, 32 + (index % columns) * (cardWidth + gap), gridY + Math.floor(index / columns) * (cardHeight + 16), start + index + 1)
        : compactCard(pet, 32 + (index % columns) * (cardWidth + gap), gridY + Math.floor(index / columns) * (cardHeight + 16), cardWidth, cardHeight, start + index + 1),
      ).join('')}
      ${empty}
      ${text(32, height - 55, result.notice || (result.query ? '匹配度表示尺寸符合程度，不代表真实孵出概率。' : '同蛋组精灵可配种，孵蛋结果跟随母体；仅展示各家族最低阶形态。'), 15, palette.muted)}
      ${text(32, height - 28, `数据源：${result.source || '查蛋数据'}${result.title === '查蛋候选' ? ' · 请使用完整名称重新查询' : ''}`, 14, palette.muted)}
      </g></svg>` }
  })
}
