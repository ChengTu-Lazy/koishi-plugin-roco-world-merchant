import { Context } from 'koishi'

import { callArkmengServerFunction } from './arkmeng'
import { Config, HomeInfo, HomeLand, HomePet, HomePlot, HomeQueryData } from '../types'
import { normalizeTimestampMs, parseInteger } from '../utils/parse'

export const HOME_UID_PATTERN = /^\d{6,12}$/

export async function fetchArkmengHomeInfo(ctx: Context, config: Config, uid: string): Promise<HomeQueryData> {
  const result = await callArkmengServerFunction(ctx, config, 'ingameQuery', { uid }, '/home-query')
  const root = asRecord(result)
  if (root.ok === false) {
    throw new Error(`洛克万事屋暂未获取到家园数据：${readString(root.message) || readString(root.error) || '接口返回失败状态'}`)
  }

  const rawHome = root.home !== undefined ? root.home : result
  const home = normalizeHomeInfo(rawHome)

  if (!hasHomeData(home)) {
    throw new Error(readString(root.message) || readString(root.error) || '该 UID 暂无家园数据')
  }

  return {
    uid,
    fetchedAt: normalizeTimestampMs(root.fetchedAt) || Date.now(),
    home,
  }
}

export function normalizeHomeUid(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\D/g, '').trim()
    : ''
}

export function isValidHomeUid(uid: string) {
  return HOME_UID_PATTERN.test(uid)
}

function normalizeHomeInfo(value: unknown): HomeInfo {
  const root = asRecord(value)
  return {
    overview: normalizeOverview(root.overview),
    pets: asArray(root.pets).map(normalizePet),
    lands: asArray(root.lands).map(normalizeLand),
    plantCount: parseOptionalInteger(root.plantCount),
    plantUnlocked: Boolean(root.plantUnlocked),
  }
}

function normalizeOverview(value: unknown) {
  const overview = asRecord(value)
  return {
    homeName: readString(overview.homeName),
    homeLevel: parseOptionalInteger(overview.homeLevel),
    comfortLevel: parseOptionalInteger(overview.comfortLevel),
    experience: parseOptionalInteger(overview.experience),
  }
}

function normalizePet(value: unknown): HomePet {
  const pet = asRecord(value)
  return {
    name: readString(pet.name),
    petCfgId: parseOptionalInteger(pet.petCfgId),
    level: parseOptionalInteger(pet.level),
    gender: parseOptionalInteger(pet.gender),
    mutationType: parseOptionalInteger(pet.mutationType),
    hasEgg: Boolean(pet.hasEgg),
    status: parseOptionalInteger(pet.status),
  }
}

function normalizeLand(value: unknown): HomeLand {
  const land = asRecord(value)
  return {
    plots: asArray(land.plots).map(normalizePlot),
  }
}

function normalizePlot(value: unknown): HomePlot {
  const plot = asRecord(value)
  return {
    plotId: parseOptionalInteger(plot.plotId),
    seedId: parseOptionalInteger(plot.seedId),
    state: parseOptionalInteger(plot.state),
    ripTime: parseOptionalInteger(plot.ripTime),
    harvestNum: parseOptionalInteger(plot.harvestNum),
    canStealCount: parseOptionalInteger(plot.canStealCount),
    stealCount: parseOptionalInteger(plot.stealCount),
  }
}

function hasHomeData(home: HomeInfo) {
  return Boolean(
    Object.values(home.overview || {}).some(value => value !== undefined && value !== '')
    || home.pets?.length
    || home.lands?.length
    || home.plantCount,
  )
}

function parseOptionalInteger(value: unknown) {
  return parseInteger(value) ?? undefined
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
