import { HomeInfo, HomePet, HomePlot, HomeQueryResult } from '../types'
import {
  flattenHomePlots,
  getGuardHomePets,
  getHomeEggPets,
  getHomePlotName,
  getHomeStealLeft,
  getLivingHomePets,
  getPlantedHomePlots,
  getRipeHomePlots,
} from '../utils/home'
import { formatDateTime } from '../utils/time'

const MAX_PET_LINES = 10

export function buildHomeQueryMessage(result: HomeQueryResult, timezoneOffset: number) {
  const home = result.home
  const overview = home.overview || {}
  const homeName = overview.homeName || '未命名家园'
  const livingPets = getLivingHomePets(home)
  const guardPets = getGuardHomePets(home)
  const eggs = getHomeEggPets(home)
  const plots = flattenHomePlots(home)
  const plantedPlots = getPlantedHomePlots(home)
  const ripePlots = getRipeHomePlots(home)
  const stealLeft = plantedPlots.reduce((total, plot) => total + getHomeStealLeft(plot), 0)

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
    lines.push(...plantedPlots.map(formatPlot))
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
    formatMutation(pet),
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
  const seedName = getHomePlotName(plot)
  const remain = formatPlotRemain(plot)
  const harvest = plot.harvestNum != null ? `产量 ${plot.harvestNum}` : '产量未知'
  return `${index + 1}. ${seedName}：${remain} | ${harvest} | 可偷 ${getHomeStealLeft(plot)}`
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

function formatGender(gender: number | undefined) {
  if (gender === 1) return '♂'
  if (gender === 2) return '♀'
  return ''
}

function formatMutation(pet: HomePet) {
  if (pet.mutationName && pet.mutationName !== '普通') return pet.mutationName
  if (pet.mutationType === 1) return '异色'
  if (pet.mutationType === 8) return '炫彩'
  if (pet.mutationType === 9) return '异色炫彩'
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
