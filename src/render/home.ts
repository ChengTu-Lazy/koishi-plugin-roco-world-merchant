import { HomeInfo, HomePet, HomePlot, HomeQueryResult } from '../types'
import { formatDateTime } from '../utils/time'

const GUARD_STATUS = 1704
const MAX_PET_LINES = 10
const MAX_PLOT_LINES = 12

const SEED_NAMES: Record<number, string> = {
  330001: '向阳花',
  330002: '伞伞菌',
  330003: '蓝掌',
  330004: '睡铃',
  330005: '天使草',
  330006: '喵喵草',
  330007: '蜜黄菌',
  330008: '喷气菇',
  330009: '幽幽草',
  330010: '星霜花',
  330011: '雪菇',
  330012: '花星角',
  330013: '荧光兰',
  330014: '大嘴花',
  330015: '流星兰',
  330016: '紫晶菇',
  330017: '海桑花',
  330018: '恶魔雪茄',
  330019: '火焰花',
  330020: '彩玉花',
  330021: '象牙花',
  330022: '海神花',
  330023: '紫雀花',
  330024: '短木莲',
}

export function buildHomeQueryMessage(result: HomeQueryResult, timezoneOffset: number) {
  const home = result.home
  const overview = home.overview || {}
  const homeName = overview.homeName || '未命名家园'
  const pets = Array.isArray(home.pets) ? home.pets : []
  const livingPets = pets.filter(pet => pet.status !== GUARD_STATUS)
  const guardPets = pets.filter(pet => pet.status === GUARD_STATUS)
  const eggs = livingPets.filter(pet => pet.hasEgg)
  const plots = flattenPlots(home)
  const plantedPlots = plots.filter(plot => !isEmptyPlot(plot))
  const ripePlots = plantedPlots.filter(isRipePlot)
  const stealLeft = plantedPlots.reduce((total, plot) => total + getStealLeft(plot), 0)

  const lines = [
    `【家园查询】${homeName}`,
    `UID：${result.uid} | 来源：${formatOrigin(result.origin)} | 更新时间：${formatDateTime(result.fetchedAt, timezoneOffset)}`,
    `家园：Lv.${formatValue(overview.homeLevel)} | 舒适度：${formatValue(overview.comfortLevel)} | 经验：${formatValue(overview.experience)}`,
    `精灵：居住 ${livingPets.length} | 守护 ${guardPets.length} | 待拾取蛋 ${eggs.length}`,
  ]

  if (result.warning) {
    lines.push(result.warning)
  }

  if (livingPets.length) {
    lines.push(`居住精灵：${formatPetList(livingPets)}`)
  }

  if (guardPets.length) {
    lines.push(`守护精灵：${formatPetList(guardPets)}`)
  }

  if (eggs.length) {
    lines.push(`待拾取蛋：${formatEggList(eggs)}`)
  }

  lines.push(buildPlantSummary(home, plots, plantedPlots, ripePlots, stealLeft))

  if (plantedPlots.length) {
    lines.push('作物：')
    lines.push(...plantedPlots.slice(0, MAX_PLOT_LINES).map(formatPlot))
    if (plantedPlots.length > MAX_PLOT_LINES) {
      lines.push(`…还有 ${plantedPlots.length - MAX_PLOT_LINES} 块作物未展示`)
    }
  }

  return lines.join('\n')
}

function formatPetList(pets: HomePet[]) {
  const items = pets.slice(0, MAX_PET_LINES).map(formatPet)
  if (pets.length > MAX_PET_LINES) {
    items.push(`等 ${pets.length} 只`)
  }
  return items.join('，')
}

function formatPet(pet: HomePet) {
  const parts = [
    pet.name || '未知精灵',
    pet.level != null ? `Lv.${pet.level}` : '',
    formatGender(pet.gender),
    pet.mutationType ? '异色' : '',
  ].filter(Boolean)
  return parts.join(' ')
}

function formatEggList(pets: HomePet[]) {
  const names = pets.slice(0, MAX_PET_LINES).map(pet => `${pet.name || '未知精灵'}的蛋`)
  if (pets.length > MAX_PET_LINES) {
    names.push(`等 ${pets.length} 个`)
  }
  return names.join('，')
}

function buildPlantSummary(
  home: HomeInfo,
  plots: HomePlot[],
  plantedPlots: HomePlot[],
  ripePlots: HomePlot[],
  stealLeft: number,
) {
  if (!home.plantUnlocked) {
    return '种植园：未解锁'
  }

  return `种植园：${plantedPlots.length}/${plots.length || home.plantCount || 0} 块已种植 | 已成熟 ${ripePlots.length} | 可偷取 ${stealLeft}`
}

function formatPlot(plot: HomePlot, index: number) {
  const seedName = getSeedName(plot.seedId)
  const remain = formatPlotRemain(plot)
  const harvest = plot.harvestNum != null ? `产量 ${plot.harvestNum}` : '产量未知'
  return `${index + 1}. ${seedName}：${remain} | ${harvest} | 可偷 ${getStealLeft(plot)}`
}

function flattenPlots(home: HomeInfo) {
  return (home.lands || []).flatMap(land => land.plots || [])
}

function isEmptyPlot(plot: HomePlot) {
  return plot.state === 0 || !plot.seedId
}

function isRipePlot(plot: HomePlot) {
  return Boolean(plot.ripTime && plot.ripTime <= Math.floor(Date.now() / 1000))
}

function formatPlotRemain(plot: HomePlot) {
  if (!plot.ripTime) return '成熟时间未知'
  const remain = plot.ripTime - Math.floor(Date.now() / 1000)
  if (remain <= 0) return '已成熟'
  return `${formatDurationSeconds(remain)}后成熟`
}

function formatDurationSeconds(seconds: number) {
  const hour = Math.floor(seconds / 3600)
  const minute = Math.floor((seconds % 3600) / 60)
  const second = seconds % 60
  if (hour) return `${hour}时${minute}分`
  if (minute) return `${minute}分${second}秒`
  return `${second}秒`
}

function getStealLeft(plot: HomePlot) {
  return Math.max(0, (plot.canStealCount || 0) - (plot.stealCount || 0))
}

function getSeedName(seedId: number | undefined) {
  return seedId ? SEED_NAMES[seedId] || `种子 ${seedId}` : '空地'
}

function formatGender(gender: number | undefined) {
  if (gender === 1) return '♂'
  if (gender === 2) return '♀'
  return ''
}

function formatValue(value: unknown) {
  return value == null || value === '' ? '—' : String(value)
}

function formatOrigin(origin: HomeQueryResult['origin']) {
  if (origin === 'cache') return '短缓存'
  if (origin === 'stale') return '旧缓存回退'
  return '实时请求'
}
