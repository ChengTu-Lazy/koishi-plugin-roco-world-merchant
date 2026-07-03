import { Context } from 'koishi'

import { callArkmengServerFunction } from './arkmeng'
import { resolvePetIconUrl } from './pet-icons'
import { buildArkmengPlantIconUrl } from './plant-icons'
import { callRocomApi } from './rocom-api'
import { Config, HomeInfo, HomeLand, HomePet, HomePlot, HomeQueryData } from '../types'
import { getHomeSeedName } from '../utils/home'
import { normalizeTimestampMs, parseInteger } from '../utils/parse'

export const HOME_UID_PATTERN = /^\d{6,12}$/
const MAGIC_BOOK_HOME_INFO_PATH = '/api/v1/games/rocom/ingame/home/info'

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

export async function fetchMagicBookHomeInfo(ctx: Context, config: Config, uid: string): Promise<HomeQueryData> {
  const result = await callRocomApi(ctx, config, MAGIC_BOOK_HOME_INFO_PATH, { uid })
  const root = asRecord(result)
  if (root.ok === false) {
    throw new Error(`洛克魔法书暂未获取到家园数据：${readString(root.message) || readString(root.error) || '接口返回失败状态'}`)
  }

  const rawHome = resolveHomePayload(result)
  const home = normalizeHomeInfo(rawHome)
  if (!hasHomeData(home)) {
    throw new Error(readString(root.message) || readString(root.error) || '该 UID 暂无家园数据')
  }

  return {
    uid,
    fetchedAt: normalizeTimestampMs(readFirst(root, ['fetchedAt', 'updatedAt', 'update_time', 'updateTime', 'time'])) || Date.now(),
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
  if (isMagicBookHomeInfo(root)) {
    return normalizeMagicBookHomeInfo(root)
  }

  return {
    overview: normalizeOverview(root.overview),
    pets: asArray(root.pets).map(normalizePet),
    lands: asArray(root.lands).map(normalizeLand),
    plantCount: parseOptionalInteger(readFirst(root, ['plantCount', 'plant_count'])),
    plantUnlocked: readBoolean(root.plantUnlocked),
  }
}

function resolveHomePayload(value: unknown) {
  const root = asRecord(value)
  const data = asRecord(root.data)
  const result = asRecord(root.result)
  if (root.home !== undefined) return root.home
  if (root.home_info !== undefined) return root.home_info
  if (data.home !== undefined) return data.home
  if (data.home_info !== undefined) return data.home_info
  if (result.home !== undefined) return result.home
  if (result.home_info !== undefined) return result.home_info
  if (Object.keys(data).length) return data
  if (Object.keys(result).length) return result
  return value
}

function isMagicBookHomeInfo(root: Record<string, unknown>) {
  return Boolean(root.friend_home_brief_info || root.friend_cell_home_brief_info || root.home_feature_opened !== undefined)
}

function normalizeMagicBookHomeInfo(value: Record<string, unknown>): HomeInfo {
  const overview = asRecord(value.friend_home_brief_info)
  const cell = asRecord(value.friend_cell_home_brief_info)
  const plantInfo = asRecord(cell.home_plant_info)

  return {
    overview: normalizeOverview({
      homeName: overview.home_name,
      homeLevel: overview.home_level,
      comfortLevel: overview.home_comfort_level,
      experience: overview.home_experience,
    }),
    pets: asArray(cell.home_pets).map(normalizePet),
    lands: normalizeMagicBookLands(plantInfo),
    plantCount: parseOptionalInteger(readFirst(plantInfo, ['plant_count', 'home_plant_land_count']) ?? readFirst(cell, ['plant_count'])),
    plantUnlocked: readBoolean(plantInfo.unlock ?? value.home_feature_opened),
  }
}

function normalizeMagicBookLands(value: unknown): HomeLand[] {
  const plantInfo = asRecord(value)
  return asArray(readFirst(plantInfo, ['home_plant_land_list', 'land_list', 'lands'])).map(normalizeLand)
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
  const homePet = asRecord(pet.home_pet_info)
  const display = asRecord(pet.display_info)
  const feedInfo = asRecord(homePet.feed_info)
  const nestedName = readFirstString(homePet, ['name', 'pet_default_name', 'petDefaultName'])
    || readFirstString(display, ['name', 'pet_default_name', 'petDefaultName'])
  const petCfgId = parseOptionalInteger(readFirst(pet, ['petCfgId', 'pet_cfg_id', 'baseConfId', 'base_conf_id'])
    ?? readFirst(homePet, ['petCfgId', 'pet_cfg_id'])
    ?? readFirst(display, ['baseConfId', 'base_conf_id']))
  const mutationType = parseOptionalInteger(readFirst(pet, ['mutationType', 'mutation_type']) ?? readFirst(display, ['mutationType', 'mutation_type']))
  const inspirationReadyAt = normalizeEpochSeconds(readFirst(homePet, ['pet_rip_time', 'rip_time']) ?? readFirst(pet, ['pet_rip_time', 'rip_time']))
  const feedBeginTime = normalizeEpochSeconds(readFirst(feedInfo, ['begin_time', 'beginTime']))
  const inspirationDuration = normalizeDurationSeconds(readFirst(homePet, ['time_cost', 'timeCost']) ?? readFirst(feedInfo, ['time_cost', 'timeCost']))
  const name = nestedName || readFirstString(pet, ['mutation_name', 'mutationName', 'pet_default_name', 'petDefaultName', 'name'])
  return {
    name,
    petCfgId,
    iconUrl: resolvePetIconUrl(petCfgId, name),
    level: parseOptionalInteger(readFirst(pet, ['level']) ?? readFirst(display, ['level'])),
    gender: parseOptionalInteger(readFirst(pet, ['gender']) ?? readFirst(display, ['gender'])),
    energy: parseOptionalInteger(readFirst(pet, ['energy']) ?? readFirst(display, ['energy'])),
    feedRound: parseOptionalInteger(readFirst(homePet, ['feed_round', 'feedRound'])),
    mutationType,
    mutationName: readFirstString(pet, ['mutationName', 'mutation_name'])
      || readFirstString(display, ['mutationName', 'mutation_name'])
      || formatMutationName(mutationType),
    inspirationReadyAt: inspirationReadyAt || (feedBeginTime && inspirationDuration ? feedBeginTime + inspirationDuration : undefined),
    inspirationDuration,
    hasEgg: readBoolean(readFirst(pet, ['hasEgg', 'have_egg'])),
    status: parseOptionalInteger(readFirst(pet, ['status']) ?? readFirst(homePet, ['status'])),
  }
}

function normalizeLand(value: unknown): HomeLand {
  const land = asRecord(value)
  return {
    plots: asArray(readFirst(land, ['plots', 'home_plant_list', 'plant_list'])).map(normalizePlot),
  }
}

function normalizePlot(value: unknown): HomePlot {
  const plot = asRecord(value)
  const display = asRecord(plot.display_info)
  const seedInfo = asRecord(readFirst(plot, ['seed_info', 'plant_seed_info', 'plant_info']))
  const plantTabId = parseOptionalInteger(readFirst(plot, ['plantTabId', 'plant_tab_id']))
  const growDuration = normalizeDurationSeconds(readFirst(plot, ['growDuration', 'grow_duration', 'time_cost', 'total_time']))
    || (plantTabId ? plantTabId * 21600 : undefined)
  const seedId = parseOptionalInteger(readFirst(plot, ['seedId', 'seed_id', 'plant_seed_id']))
  const seedName = readFirstString(plot, ['plant_seed_name', 'plantSeedName', 'seedName'])
  const displayName = seedName || getHomeSeedName(seedId)
  return {
    plotId: parseOptionalInteger(readFirst(plot, ['plotId', 'plot_id', 'plant_id'])),
    seedId,
    seedName,
    iconUrl: readFirstImageUrl(plot) || readFirstImageUrl(display) || readFirstImageUrl(seedInfo) || (seedId ? buildArkmengPlantIconUrl(displayName) : undefined),
    state: parseOptionalInteger(readFirst(plot, ['state', 'plant_state'])),
    ripTime: normalizeEpochSeconds(readFirst(plot, ['ripTime', 'rip_time', 'plant_rip_time', 'end_time', 'finish_time'])),
    growDuration,
    harvestNum: parseOptionalInteger(readFirst(plot, ['harvestNum', 'harvest_num', 'plant_harvest_num'])),
    canStealCount: parseOptionalInteger(readFirst(plot, ['canStealCount', 'can_steal_count', 'plant_can_steal_account'])),
    stealCount: parseOptionalInteger(readFirst(plot, ['stealCount', 'steal_count', 'plant_steal_account'])),
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

function formatMutationName(mutationType: number | undefined) {
  if (mutationType === 1) return '异色'
  if (mutationType === 8) return '炫彩'
  if (mutationType === 9) return '异色炫彩'
  return undefined
}

function normalizeEpochSeconds(value: unknown) {
  const timestamp = parseInteger(value)
  if (!timestamp || timestamp <= 0) return undefined
  if (timestamp > 1e13) return Math.floor(timestamp / 1e6)
  if (timestamp > 1e10) return Math.floor(timestamp / 1e3)
  return Math.floor(timestamp)
}

function normalizeDurationSeconds(value: unknown) {
  const duration = parseInteger(value)
  if (!duration || duration <= 0) return undefined
  if (duration > 1e9) return Math.floor(duration / 1e6)
  if (duration > 1e6) return Math.floor(duration / 1e3)
  return Math.floor(duration)
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function readFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readString(record[key])
    if (value) return value
  }
  return undefined
}

function readFirstImageUrl(record: Record<string, unknown>) {
  return normalizeImageUrl(readFirst(record, [
    'iconUrl',
    'icon_url',
    'icon',
    'image',
    'img',
    'pic',
    'picture',
    'plantIcon',
    'plant_icon',
    'plantSeedIcon',
    'plant_seed_icon',
  ]))
}

function normalizeImageUrl(value: unknown) {
  const url = readString(value)
  if (!url) return undefined
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `https://rocom.shallow.ink${url}`
  return undefined
}

function readFirst(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function readBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    if (['true', '1', 'yes', 'y', 'on', '是', '已开启'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off', '否', '未开启'].includes(normalized)) return false
  }
  return false
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
