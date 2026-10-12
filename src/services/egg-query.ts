import { Context, Logger } from 'koishi'

import { eggRows } from '../data/egg-data'
import { eggFamilyRoots } from '../data/egg-families'
import { callRocomApi } from '../sources/rocom-api'
import { resolvePetIconUrl } from '../sources/pet-icons'
import { fetchBwikiEgg } from '../sources/egg'
import { Config } from '../types'

const groups = ['未知', '未发现', '怪兽', '两栖', '虫', '飞行', '陆上', '妖精', '植物', '人型', '软体', '矿物', '不定形', '鱼', '龙', '机械']
export const EGG_USAGE = '查蛋用法：\n查蛋 <精灵名>\n查蛋 0.18 1.5\n查蛋 身高0.18m 体重1.5kg\n身高单位为米，体重单位为千克；也可仅输入身高或“体重1.5kg”。'
export type EggQuery = { name: string } | { height?: number; weight?: number }
export interface EggCard {
  id: string
  name: string
  icon?: string
  type?: string
  groups?: string
  height: string
  weight: string
  score?: number
  scoreLabel?: string
  fitScore?: number
  confidence?: string
  matchLabel?: string
  sizeClass?: string
  hatch?: string
  familyBase?: string
}
export interface EggSection { title: string; total: number; cards: EggCard[] }
export interface EggResult {
  title: string
  lines: string[]
  query?: { height?: number; weight?: number }
  source?: string
  notice?: string
  pet?: EggCard
  sections?: EggSection[]
}

function localCard(pet: typeof eggRows[number], weight?: number): EggCard {
  const labels = eggRowLabels(pet)
  return {
    id: String(pet[0]), name: pet[1], icon: resolvePetIconUrl(pet[0], pet[1]),
    type: pet[3], groups: groupNames(pet[4]),
    height: labels.height, weight: labels.weight,
    sizeClass: sizeClass(weight, pet[7] == null ? undefined : pet[7] / 1000, pet[8] == null ? undefined : pet[8] / 1000).replace(/^ · /, ''),
    hatch: labels.hatch,
  }
}

function apiIcon(item: any, id: unknown, name: string) {
  const supplied = item.pet_icon_url || item.icon_url || item.petIcon || item.icon
  if (typeof supplied === 'string' && /^https?:\/\//i.test(supplied)) return supplied
  const numericId = number(id)
  return resolvePetIconUrl(numericId == null ? undefined : numericId < 3000 ? numericId + 3000 : numericId, name)
}

function apiNameCard(item: any): EggCard {
  const id = item.id ?? item.pet_id ?? '-'
  const name = String(item.name || item.pet_name || '未知精灵')
  const labels = apiEggLabels(item, id, name)
  return {
    id: String(id), name, icon: apiIcon(item, id, name),
    type: Array.isArray(item.unit_type) ? item.unit_type.join(' / ') : undefined,
    groups: Array.isArray(item.egg_groups) ? item.egg_groups.map((group: any) => officialGroupName(group)).filter(Boolean).join(' / ') : undefined,
    height: labels.height, weight: labels.weight, hatch: labels.hatch,
  }
}

function officialGroupName(group: any) {
  return group?.official_name || group?.name || ''
}

export function parseEggQuery(args: string[]): EggQuery {
  if (!args.length) throw new Error(EGG_USAGE)
  let height: number | undefined
  let weight: number | undefined
  const names: string[] = []
  for (const arg of args) {
    const match = /^(?:(身高|高度|h|体重|重量|w)\s*)?([0-9]+(?:\.[0-9]+)?)\s*(m|米|kg|千克|公斤)?$/i.exec(arg.trim())
    if (!match) {
      if (/^(身高|高度|体重|重量)|^[+\-\d.]|^(?:nan|infinity)$/i.test(arg)) throw new Error('尺寸格式不正确，请输入正数，身高用米、体重用千克。')
      names.push(arg)
      continue
    }
    const prefix = (match[1] || '').toLowerCase()
    const unit = (match[3] || '').toLowerCase()
    const isWeight = ['体重', '重量', 'w'].includes(prefix) || ['kg', '千克', '公斤'].includes(unit)
    const isHeight = ['身高', '高度', 'h'].includes(prefix) || ['m', '米'].includes(unit)
    if (isWeight && isHeight) throw new Error('身高和体重的单位不一致，请使用 m 和 kg。')
    const value = Number(match[2])
    if (!Number.isFinite(value) || value <= 0) throw new Error('身高和体重必须是大于 0 的有限数字。')
    if (isWeight || (!isHeight && height != null)) {
      if (weight != null) throw new Error('体重重复，请只输入一个体重。')
      weight = value
    } else {
      if (height != null) throw new Error('身高重复，请只输入一个身高。')
      height = value
    }
  }
  if (names.length && (height != null || weight != null)) throw new Error('请使用精灵名查询，或使用身高体重反查，不要混合输入。')
  return names.length ? { name: names.join(' ') } : { height, weight }
}

function number(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const result = Number(value)
  return Number.isFinite(result) ? result : undefined
}

function range(low: unknown, high: unknown, unit: string) {
  const a = number(low), b = number(high)
  return a == null || b == null ? '暂无数据' : `${a}–${b}${unit}`
}

function groupNames(ids: number[]) {
  return ids.map(id => groups[id] || `蛋组${id}`).join(' / ') || '暂无蛋组数据'
}

const familyRoots = new Map<number, number>(Object.entries(eggFamilyRoots).map(([id, root]) => [Number(id), Number(root)]))
const petRows = new Map<number, typeof eggRows[number]>(eggRows.map(row => [row[0], row]))
const petNames = new Map<number, string>(eggRows.map(row => [row[0], row[1]]))
const petIds = new Set(petNames.keys())
// 同名变体既可能是最低阶形态，也可能是进化形态，这类重名不能按名称过滤。
const evolvedOnlyNames = (() => {
  const evolved = new Set<string>()
  const lowest = new Set<string>()
  for (const row of eggRows) (familyRoots.has(row[0]) ? evolved : lowest).add(row[1])
  for (const name of lowest) evolved.delete(name)
  return evolved
})()

function petName(name: string) {
  return name.replace(/[（(].*?[)）]/g, '').trim()
}

/** 返回该精灵所在家族的最低阶精灵 ID；本身已是最低阶或不在内置数据中时返回 undefined。 */
function familyRootOf(id: unknown) {
  const value = number(id)
  if (value == null) return undefined
  // 部分接口沿用旧编号，与图标地址一样按 +3000 兼容。
  return familyRoots.get(value) ?? (value < 3000 ? familyRoots.get(value + 3000) : undefined)
}

/** 名称查询默认只展示各家族最低阶形态；ID 能对上内置数据时以 ID 为准。 */
function isLowestStage(id: unknown, name?: string) {
  if (familyRootOf(id) != null) return false
  const value = number(id)
  if (value != null && (petIds.has(value) || petIds.has(value + 3000))) return true
  return !name || !evolvedOnlyNames.has(petName(name))
}

function familyBaseLabel(root: number | undefined) {
  if (root == null) return undefined
  const name = petNames.get(root)
  return name ? `${name} #${root}` : undefined
}

// 官方图标与蛋组数据都挂在 3xxx 正式编号上。
const OFFICIAL_PET_ID_MIN = 3000
const OFFICIAL_PET_ID_MAX = 3999

/** 同名重复行（活动/首领/特殊编号）优先取有蛋组、且编号在正式区间内的记录。 */
function canonicalScore(row: typeof eggRows[number]) {
  let score = 0
  if (row[4].length && !row[4].includes(1)) score += 2
  if (row[0] >= OFFICIAL_PET_ID_MIN && row[0] <= OFFICIAL_PET_ID_MAX) score += 1
  return score
}

/** 按名称去重，同名时取更“正式”的一行；并列时保持原有“后者优先”行为。 */
function pickCanonicalByName(rows: (typeof eggRows[number])[]) {
  const picked = new Map<string, typeof eggRows[number]>()
  for (const row of rows) {
    const current = picked.get(row[1])
    if (!current || canonicalScore(row) >= canonicalScore(current)) picked.set(row[1], row)
  }
  return [...picked.values()]
}

/** 内置数据的蛋尺寸与孵化时长，内部为厘米、克，展示为米、千克。 */
function eggRowLabels(row: typeof eggRows[number]) {
  return {
    height: range(row[5] == null ? null : row[5] / 100, row[6] == null ? null : row[6] / 100, 'm'),
    weight: range(row[7] == null ? null : row[7] / 1000, row[8] == null ? null : row[8] / 1000, 'kg'),
    hatch: row[9] ? `${Number((row[9] / 3600).toFixed(2))}小时` : '暂无数据',
  }
}

function findPetRow(id: unknown, name?: string) {
  const value = number(id)
  if (value != null) {
    const row = petRows.get(value) ?? (value < 3000 ? petRows.get(value + 3000) : undefined)
    if (row) return row
  }
  const key = name ? petName(name) : ''
  return key ? eggRows.find(row => row[1] === key) : undefined
}

/**
 * 接口的 height_range_m/weight_range_kg 是精灵体型范围，不是孵化尺寸，
 * 因此名称查询只认显式的 egg_size，其余情况一律回退内置快照，避免把体型当蛋尺寸展示。
 */
function apiEggSize(item: any) {
  const eggSize = item?.egg_size && typeof item.egg_size === 'object' ? item.egg_size : {}
  const height = eggSize.height && typeof eggSize.height === 'object' ? eggSize.height : {}
  const weight = eggSize.weight && typeof eggSize.weight === 'object' ? eggSize.weight : {}
  const hLow = number(height.min_m), hHigh = number(height.max_m)
  const wLow = number(weight.min_kg), wHigh = number(weight.max_kg)
  if (hLow == null && hHigh == null && wLow == null && wHigh == null) return undefined
  return { height: range(hLow, hHigh, 'm'), weight: range(wLow, wHigh, 'kg'), hatch: undefined as string | undefined }
}

function apiEggLabels(item: any, id: unknown, name: string) {
  const direct = apiEggSize(item)
  if (direct) return direct
  const row = findPetRow(id, name)
  return row ? eggRowLabels(row) : { height: '暂无数据', weight: '暂无数据', hatch: undefined as string | undefined }
}

function localScore(value: number | undefined, low: number | null, high: number | null) {
  if (value == null) return undefined
  if (low == null || high == null) return null
  if (value >= low && value <= high) return 100
  const boundary = value < low ? low : high
  const distance = Math.abs(value - boundary)
  const tolerance = Math.max(boundary * 0.15, 0.0001)
  if (distance > tolerance + 1e-9) return null
  return Math.max(0, 100 * (1 - distance / tolerance))
}

export function queryLocalEgg(query: EggQuery): EggResult {
  if ('name' in query) {
    const key = query.name.toLowerCase()
    const exact = eggRows.filter(row => row[1] === query.name || row[2].toLowerCase() === key)
    // 同名重复行取正式编号那条，避免命中活动/首领编号（蛋组为空、图标 404）。
    const matches = pickCanonicalByName(exact.length ? exact : eggRows.filter(row => row[1].includes(query.name) || row[2].toLowerCase().includes(key)))
    if (!matches.length) return { title: '查蛋', lines: [`未找到「${query.name}」，请检查精灵名称。`] }
    if (matches.length > 1) return { title: '查蛋候选', source: '本地快照', sections: [{ title: '名称候选 · 请使用更精确名称', total: matches.length, cards: matches.slice(0, 20).map(row => localCard(row)) }], lines: ['找到多个候选，请使用更精确名称：', ...matches.slice(0, 20).map(row => `${row[1]} #${row[0]}`), '数据源：本地快照'] }
    const pet = matches[0]
    // 先折叠同家族进化形态再按名称去重，避免重名变体把最低阶形态挤掉。
    const compatible = pet[4].includes(1) ? [] : pickCanonicalByName(eggRows
      .filter(row => row[1] !== pet[1] && !row[4].includes(1) && row[4].some(id => pet[4].includes(id)))
      .filter(row => !familyRoots.has(row[0])))
    const familyBase = familyBaseLabel(familyRootOf(pet[0]))
    const labels = eggRowLabels(pet)
    return { title: `查蛋 · ${pet[1]}`, pet: { ...localCard(pet), familyBase }, source: '本地快照', sections: [{ title: pet[4].includes(1) ? '未发现蛋组 · 不能配种' : '同蛋组可配种精灵 · 仅最低阶', total: compatible.length, cards: compatible.slice(0, 30).map(row => localCard(row)) }], lines: [
      `精灵：${pet[1]} #${pet[0]}　属性：${pet[3] || '未知'}`,
      ...(familyBase ? [`家族最低阶：${familyBase}`] : []),
      `蛋组：${groupNames(pet[4])}`,
      `蛋身高：${labels.height}`,
      `蛋体重：${labels.weight}`,
      `孵化时长：${labels.hatch}`,
      pet[4].includes(1) ? '未发现蛋组，不能配种。' : `可配种精灵：${compatible.length}只（同蛋组 · 仅最低阶，已折叠同家族进化形态）`,
      ...compatible.slice(0, 30).map(row => `${row[1]} #${row[0]} · ${groupNames(row[4])}`),
      ...(compatible.length > 30 ? ['仅展示前30只可配种精灵。'] : []),
      '数据源：本地快照',
    ] }
  }
  const rawCandidates = eggRows.flatMap(pet => {
    const h = localScore(query.height == null ? undefined : query.height * 100, pet[5], pet[6])
    const w = localScore(query.weight == null ? undefined : query.weight * 1000, pet[7], pet[8])
    const scores = [h, w].filter(value => value != null) as number[]
    if (!scores.length || (query.height != null && h == null) || (query.weight != null && w == null)) return []
    return [{ pet, perfect: scores.every(value => value === 100), score: scores.reduce((a, b) => a + b, 0) / scores.length }]
  }).sort((a, b) => Number(b.perfect) - Number(a.perfect) || b.score - a.score)
  // 同名形态只显示最高匹配项，避免重复卡片和相加后超过100%的匹配度；同分时取正式编号那条。
  const chosen = new Map<string, typeof rawCandidates[number]>()
  for (const item of rawCandidates) {
    const current = chosen.get(item.pet[1])
    if (!current) {
      chosen.set(item.pet[1], item)
      continue
    }
    const tied = current.perfect === item.perfect && current.score === item.score
    if (tied && canonicalScore(item.pet) >= canonicalScore(current.pet)) chosen.set(item.pet[1], item)
  }
  const candidates = [...chosen.values()]
  const lines = [sizeLabel(query)]
  const sections: EggSection[] = []
  for (const perfect of [true, false]) {
    const matches = candidates.filter(item => item.perfect === perfect)
    if (!matches.length) continue
    sections.push({ title: perfect ? '完美匹配' : '范围匹配 · 容差15%', total: matches.length, cards: matches.slice(0, 20).map(({ pet, score }) => ({ ...localCard(pet, query.weight), score, matchLabel: perfect ? '完美匹配' : '范围匹配' })) })
    lines.push(`${perfect ? '完美匹配' : '范围匹配（容差15%）'}：${matches.length}只`)
    for (const { pet, score } of matches.slice(0, 20)) {
      lines.push(`${pet[1]} #${pet[0]} · 匹配度 ${Number(score.toFixed(2))}%${sizeClass(query.weight, pet[7] == null ? undefined : pet[7] / 1000, pet[8] == null ? undefined : pet[8] / 1000)}`)
      lines.push(`  身高 ${range(pet[5] == null ? null : pet[5] / 100, pet[6] == null ? null : pet[6] / 100, 'm')} / 体重 ${range(pet[7] == null ? null : pet[7] / 1000, pet[8] == null ? null : pet[8] / 1000, 'kg')} · ${groupNames(pet[4])}`)
    }
    if (matches.length > 20) lines.push('该组仅展示前20只。')
  }
  if (!candidates.length) lines.push('未找到符合当前尺寸的精灵。')
  lines.push('匹配度表示尺寸符合程度，不代表真实孵出概率。', '数据源：本地快照')
  return { title: '查蛋 · 尺寸反查', lines, query, sections, source: '本地快照' }
}

function sizeLabel(query: { height?: number; weight?: number }) {
  return [query.height == null ? '' : `身高 ${query.height}m`, query.weight == null ? '' : `体重 ${query.weight}kg`].filter(Boolean).join(' / ')
}

function sizeClass(weight?: number, low?: number, high?: number) {
  if (weight == null || low == null || high == null || high <= low || weight < low || weight > high) return ''
  if (weight <= low + (high - low) * 0.05) return ' · 小块头'
  if (weight >= high - (high - low) * 0.05) return ' · 大块头'
  return ''
}

function apiItems(response: any): any[] {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.items)) return response.items
  throw new Error('查蛋接口返回结构不正确')
}

function apiSizeResult(response: any, query: { height?: number; weight?: number }): EggResult {
  let items: any[]
  if (Array.isArray(response?.items)) items = response.items
  else if (Array.isArray(response?.exactResults) && Array.isArray(response?.candidates)) {
    items = [...response.exactResults.map((item: any) => ({ ...item, exact: true })), ...response.candidates]
  } else throw new Error('尺寸接口返回结构不正确')
  const lines = [sizeLabel(query)]
  const sections: EggSection[] = [ { title: '完美匹配', total: 0, cards: [] }, { title: '范围匹配', total: 0, cards: [] } ]
  if (!items.length) lines.push('未找到符合当前尺寸的精灵。')
  for (const item of items.slice(0, 30)) {
    const pet = item.pet && typeof item.pet === 'object' ? item.pet : item
    const name = pet.name || item.pet_name || (typeof item.pet === 'string' ? item.pet : '未知精灵')
    const form = pet.form && !String(name).includes(pet.form) ? `（${pet.form}）` : ''
    const height = item.egg_size?.height || {}
    const weight = item.egg_size?.weight || {}
    const hLow = number(height.min_m) ?? number(item.height_range_m?.[0]) ?? (number(item.height_range_cm?.[0]) == null ? undefined : Number(item.height_range_cm[0]) / 100) ?? number(item.diameterMin)
    const hHigh = number(height.max_m) ?? number(item.height_range_m?.[1]) ?? (number(item.height_range_cm?.[1]) == null ? undefined : Number(item.height_range_cm[1]) / 100) ?? number(item.diameterMax)
    const wLow = number(weight.min_kg) ?? number(item.weight_range_kg?.[0]) ?? (number(item.weight_range_g?.[0]) == null ? undefined : Number(item.weight_range_g[0]) / 1000) ?? number(item.weightMin)
    const wHigh = number(weight.max_kg) ?? number(item.weight_range_kg?.[1]) ?? (number(item.weight_range_g?.[1]) == null ? undefined : Number(item.weight_range_g[1]) / 1000) ?? number(item.weightMax)
    const percent = number(item.probability) ?? number(item.match?.percent)
    const layer = item.match?.layer
    const perfect = item.exact || (['strict', 'exact'].includes(layer) && !item.match?.display_only)
    const info = item.match?.match_percent_text || (percent == null ? '' : `匹配度 ${percent}%`)
    const id = pet.pet_id || pet.id || item.petId || '-'
    const section = sections[perfect ? 0 : 1]
    section.total++
    section.cards.push({
      id: String(id), name: `${name}${form}`, icon: apiIcon({ ...item, ...pet }, id, name),
      type: Array.isArray(pet.type_names) ? pet.type_names.join(' / ') : undefined,
      groups: Array.isArray(pet.egg_group_names) ? pet.egg_group_names.join(' / ') : undefined,
      height: range(hLow, hHigh, 'm'), weight: range(wLow, wHigh, 'kg'), score: percent,
      matchLabel: info || (number(item.r_value) == null ? '尺寸命中' : `R值 ${item.r_value}`),
      sizeClass: sizeClass(query.weight, wLow, wHigh).replace(/^ · /, ''),
    })
    lines.push(`${name}${form} #${pet.pet_id || pet.id || item.petId || '-'} · ${perfect ? '完美匹配' : '范围匹配'}${info ? ` · ${info}` : ''}${sizeClass(query.weight, wLow, wHigh)}`)
    lines.push(`  身高 ${range(hLow, hHigh, 'm')} / 体重 ${range(wLow, wHigh, 'kg')}${number(item.r_value) == null ? '' : ` · R值 ${item.r_value}`}`)
  }
  lines.push('接口结果仅展示当前页，最多30条。', '匹配度供参考，不代表真实孵出概率。', '数据源：洛克魔法书')
  return { title: '查蛋 · 尺寸反查', lines, query, sections: sections.filter(section => section.total), source: '洛克魔法书 · 当前页最多30条' }
}

export async function queryEgg(ctx: Context, config: Config, logger: Logger, query: EggQuery): Promise<EggResult> {
  let primaryFailed = false
  if (!('name' in query) && query.height != null && query.weight != null) {
    try {
      return await fetchBwikiEgg(ctx, config, { height: query.height, weight: query.weight })
    } catch (error) {
      primaryFailed = true
      logger.warn('BWIKI 查蛋接口不可用，尝试备用数据源：%s', error instanceof Error ? error.message : String(error))
    }
  }
  const withSourceNotice = (result: EggResult) => {
    if (!primaryFailed) return result
    result.notice = '主源暂不可用，备用数据可能不完整，结果仅供参考。'
    result.source = `${result.source || '备用数据'}（主源不可用）`
    result.lines.push(result.notice)
    return result
  }
  if (config.rocomApiKey?.trim()) {
    if (!('name' in query) && query.height != null && query.weight != null) {
      for (const path of ['/api/v1/games/rocom/egg/search', '/api/v1/games/rocom/wiki/pet-size/query']) {
        try {
          const params = path.endsWith('/egg/search')
            ? { height: query.height, weight: query.weight, page_no: 1, page_size: 30 }
            : { diameter: query.height, weight: query.weight, pool: 'magic', include_display_only: false, page_no: 1, page_size: 30 }
          return withSourceNotice(apiSizeResult(await callRocomApi(ctx, config, path, params), query))
        } catch (error) {
          logger.warn('查蛋尺寸接口不可用，尝试下一数据源：%s', error instanceof Error ? error.message : String(error))
        }
      }
    } else if ('name' in query) {
      try {
        const items = apiItems(await callRocomApi(ctx, config, '/api/v1/games/rocom/egg/pet-groups', { q: query.name, limit: 20 }))
        if (!items.length) return { title: '查蛋', lines: [`未找到「${query.name}」，请检查精灵名称。`] }
        const pet = items.find(item => item.name === query.name || `${item.name}${item.form || ''}` === query.name) || (items.length === 1 ? items[0] : null)
        if (!pet) return { title: '查蛋候选', source: '洛克魔法书', sections: [{ title: '名称候选 · 请使用更精确名称', total: items.length, cards: items.map(apiNameCard) }], lines: ['找到多个候选，请使用更精确名称：', ...items.map(item => `${item.name} #${item.id || item.pet_id || '-'}`)] }
        const eggGroups = Array.isArray(pet.egg_groups) ? pet.egg_groups : []
        const ids = eggGroups.map((group: any) => number(group.group_id ?? group.id)).filter((id: number | undefined) => id != null)
        const labels = eggGroups.map((group: any) => officialGroupName(group)).filter(Boolean)
        const sections: EggSection[] = []
        const familyBase = familyBaseLabel(familyRootOf(pet.id ?? pet.pet_id))
        const petCard = { ...apiNameCard(pet), familyBase }
        const snapshotSize = !apiEggSize(pet)
        const lines = [`精灵：${pet.name} #${pet.id || pet.pet_id || '-'}`, ...(familyBase ? [`家族最低阶：${familyBase}`] : []), `蛋组：${labels.join(' / ') || '暂无数据'}`,
          `蛋身高：${petCard.height}`,
          `蛋体重：${petCard.weight}`,
          `孵化时长：${petCard.hatch || '接口未提供'}`]
        if (ids.includes(1) || labels.some((label: string) => label.includes('未发现'))) lines.push('未发现蛋组，不能配种。')
        else if (ids.length) {
          const response = await callRocomApi(ctx, config, '/api/v1/games/rocom/egg/group-pets', { group_ids: ids.join(','), match_mode: 'any', page_no: 1, page_size: 30 })
          // 接口会返回整条进化链，这里折叠为各家族最低阶形态。
          const members = apiItems(response)
            .filter(item => String(item.id || item.pet_id) !== String(pet.id || pet.pet_id))
            .filter(item => isLowestStage(item.id ?? item.pet_id, String(item.name || item.pet_name || '')))
          sections.push({ title: '同蛋组可配种精灵 · 当前页 · 仅最低阶', total: members.length, cards: members.map(apiNameCard) })
          lines.push('同蛋组可配种精灵（当前页最多30条，已折叠同家族进化形态）：', ...members.map(item => `${item.name} #${item.id || item.pet_id || '-'}`))
        }
        lines.push(snapshotSize ? '数据源：洛克魔法书（蛋尺寸来自内置快照）' : '数据源：洛克魔法书')
        return { title: `查蛋 · ${pet.name}`, lines, pet: petCard, sections, source: snapshotSize ? '洛克魔法书 · 蛋尺寸为内置快照' : '洛克魔法书' }
      } catch (error) {
        logger.warn('查蛋名称接口不可用，回退本地数据：%s', error instanceof Error ? error.message : String(error))
      }
    }
  }
  return withSourceNotice(queryLocalEgg(query))
}
