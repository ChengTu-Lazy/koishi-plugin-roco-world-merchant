import { HomeInfo, HomePet, HomePlot } from '../types'

export const GUARD_STATUS = 1704

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

export function getLivingHomePets(home: HomeInfo) {
  return getHomePets(home).filter(pet => pet.status !== GUARD_STATUS)
}

export function getGuardHomePets(home: HomeInfo) {
  return getHomePets(home).filter(pet => pet.status === GUARD_STATUS)
}

export function getHomeEggPets(home: HomeInfo) {
  return getLivingHomePets(home).filter(pet => pet.hasEgg)
}

export function flattenHomePlots(home: HomeInfo) {
  return (home.lands || []).flatMap(land => land.plots || [])
}

export function getPlantedHomePlots(home: HomeInfo) {
  return flattenHomePlots(home).filter(plot => !isEmptyHomePlot(plot))
}

export function getRipeHomePlots(home: HomeInfo, nowSeconds = Math.floor(Date.now() / 1000)) {
  return getPlantedHomePlots(home).filter(plot => isRipeHomePlot(plot, nowSeconds))
}

export function isEmptyHomePlot(plot: HomePlot) {
  return plot.state === 0 || !plot.seedId
}

export function isRipeHomePlot(plot: HomePlot, nowSeconds = Math.floor(Date.now() / 1000)) {
  return Boolean(plot.ripTime && plot.ripTime <= nowSeconds)
}

export function getHomeStealLeft(plot: HomePlot) {
  return Math.max(0, (plot.canStealCount || 0) - (plot.stealCount || 0))
}

export function getHomeSeedName(seedId: number | undefined) {
  return seedId ? SEED_NAMES[seedId] || `种子 ${seedId}` : '空地'
}

export function getHomePlotName(plot: HomePlot) {
  return plot.seedName || getHomeSeedName(plot.seedId)
}

export function summarizeHomeAlert(home: HomeInfo) {
  const eggs = getHomeEggPets(home)
  const ripePlots = getRipeHomePlots(home)
  return {
    eggs,
    ripePlots,
    hasAlert: Boolean(eggs.length || ripePlots.length),
  }
}

function getHomePets(home: HomeInfo): HomePet[] {
  return Array.isArray(home.pets) ? home.pets : []
}
