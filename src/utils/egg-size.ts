import { eggRows } from '../data/egg-data'

export type EggRow = typeof eggRows[number]

/**
 * 大块头 / 小不点判定：
 * 身高与体重都要落在各自区间的上下 2% 内（洛克工具箱 /api/magic-egg-lookup 的 `height_edge_hint`
 * 用的就是 98-100 与 0-2 百分位窗口，且两个维度必须同时达标），
 * 与社区“大块头准入值≈区间上下 2%”“两种体型各约 2% 概率”的说法一致。
 */
export const SIZE_CLASS_RATIO = 0.02

/** 边界比较容差，只用于抵消浮点误差。 */
const EDGE_EPSILON = 1e-9

export interface EggSizeRange {
  heightLow?: number
  heightHigh?: number
  weightLow?: number
  weightHigh?: number
}

export interface EggSizeInput {
  height?: number
  weight?: number
}

const petRows = new Map<number, EggRow>(eggRows.map(row => [row[0], row]))

/** 去掉“板板壳（本来的样子）”这类形态后缀。 */
export function petDisplayName(name: string) {
  return name.replace(/[（(].*?[)）]/g, '').trim()
}

/** 按精灵 ID（兼容旧编号 +3000）或名称在内置快照里查记录。 */
export function findPetEggRow(id: unknown, name?: string) {
  const value = Number(id)
  if (Number.isFinite(value)) {
    const row = petRows.get(value) ?? (value < 3000 ? petRows.get(value + 3000) : undefined)
    if (row) return row
  }
  const key = name ? petDisplayName(name) : ''
  return key ? eggRows.find(row => row[1] === key) : undefined
}

/** 该精灵蛋的尺寸区间（米、千克），两套区间都缺失时返回 undefined。 */
export function petEggSizeRange(id: unknown, name?: string) {
  const row = findPetEggRow(id, name)
  if (!row) return undefined
  const range: EggSizeRange = {}
  if (row[5] != null && row[6] != null && row[6] > row[5]) {
    range.heightLow = row[5] / 100
    range.heightHigh = row[6] / 100
  }
  if (row[7] != null && row[8] != null && row[8] > row[7]) {
    range.weightLow = row[7] / 1000
    range.weightHigh = row[8] / 1000
  }
  return range.heightLow != null || range.weightLow != null ? range : undefined
}

export function sizeThresholds(low?: number, high?: number) {
  if (low == null || high == null || !(high > low)) return undefined
  const span = high - low
  return { small: low + span * SIZE_CLASS_RATIO, big: high - span * SIZE_CLASS_RATIO }
}

function dimensionEdge(value: number | undefined, low?: number, high?: number) {
  if (value == null || low == null || high == null || value < low || value > high) return undefined
  const limits = sizeThresholds(low, high)
  if (!limits) return undefined
  // 边界用容差取到门槛内侧，避免浮点误差让同一只蛋在两侧来回跳。
  if (value <= limits.small + EDGE_EPSILON) return 'small' as const
  if (value >= limits.big - EDGE_EPSILON) return 'large' as const
  return undefined
}

/**
 * 判断输入尺寸的体型：身高与体重必须同时进入同一侧的 2% 区间，任一维度落在中间就是普通体型。
 * 只提供了单维度尺寸时给出带限定的结论，区间数据缺失时不判定。
 */
export function sizeClassLabel(input: EggSizeInput, range: EggSizeRange) {
  const heightProvided = input.height != null
  const weightProvided = input.weight != null
  if (!heightProvided && !weightProvided) return ''
  const dimensions: { provided: boolean; judged: boolean; edge?: 'small' | 'large' }[] = [
    { provided: heightProvided, judged: range.heightLow != null && range.heightHigh != null, edge: dimensionEdge(input.height, range.heightLow, range.heightHigh) },
    { provided: weightProvided, judged: range.weightLow != null && range.weightHigh != null, edge: dimensionEdge(input.weight, range.weightLow, range.weightHigh) },
  ]
  let edge: 'small' | 'large' | undefined
  for (const dimension of dimensions) {
    if (!dimension.provided) continue
    // 区间缺失或该维度不在边缘区间，都不能认定极限体型。
    if (!dimension.judged || !dimension.edge) return ''
    if (edge && edge !== dimension.edge) return ''
    edge = dimension.edge
  }
  if (!edge) return ''
  const label = edge === 'large' ? '大块头' : '小不点'
  return heightProvided && weightProvided ? label : `${label}（仅按${heightProvided ? '身高' : '体重'}）`
}

/** 门槛对外只保留三位小数，并向外取整，避免给出刚好差一点点的数字。 */
export function formatSize(value: number, mode: 'floor' | 'ceil') {
  const scaled = (mode === 'floor' ? Math.floor(value * 1000) : Math.ceil(value * 1000)) / 1000
  return String(Number(scaled.toFixed(3)))
}

/** 该区间的小不点/大块头门槛文案（不含维度名）。 */
export function sizeRangeLabel(low?: number, high?: number) {
  const limits = sizeThresholds(low, high)
  if (!limits) return undefined
  return `小不点 ≤${formatSize(limits.small, 'floor')} · 大块头 ≥${formatSize(limits.big, 'ceil')}`
}

/**
 * 卡片与文字结果里展示的判定说明，第一行说明规则、第二行给出两套门槛。
 * 门槛对外保留三位小数并向外取整，所以用 ≤ / ≥ 表述，和判定结果保持一致。
 */
export function sizeClassNotes(range: EggSizeRange, from?: string) {
  const hasHeight = range.heightLow != null && range.heightHigh != null
  const hasWeight = range.weightLow != null && range.weightHigh != null
  if (!hasHeight && !hasWeight) return undefined
  const small: string[] = []
  const big: string[] = []
  if (hasHeight) {
    const limits = sizeThresholds(range.heightLow, range.heightHigh)!
    small.push(`身高 ≤${formatSize(limits.small, 'floor')}m`)
    big.push(`身高 ≥${formatSize(limits.big, 'ceil')}m`)
  }
  if (hasWeight) {
    const limits = sizeThresholds(range.weightLow, range.weightHigh)!
    small.push(`体重 ≤${formatSize(limits.small, 'floor')}kg`)
    big.push(`体重 ≥${formatSize(limits.big, 'ceil')}kg`)
  }
  const subject = hasHeight && hasWeight ? '身高、体重都要进各自区间 2%' : hasHeight ? '身高区间 2%' : '蛋体重区间 2%'
  return [
    `体型判定（${subject}${from ? ` · 最低阶 ${from}` : ''}）`,
    `小不点 ${small.join(' 且 ')} ｜ 大块头 ${big.join(' 且 ')}`,
  ]
}
