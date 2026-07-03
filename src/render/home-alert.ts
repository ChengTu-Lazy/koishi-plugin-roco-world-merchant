import { h } from 'koishi'

import { HomeBinding, HomePet, HomePlot, HomeQueryResult } from '../types'
import { getHomePlotName } from '../utils/home'
import { formatDateTime } from '../utils/time'

const MAX_DETAIL_ITEMS = 5

export interface HomeAlertEntry {
  binding: HomeBinding
  result: HomeQueryResult
  eggs: HomePet[]
  ripePlots: HomePlot[]
}

export function buildHomeAlertMessage(entries: HomeAlertEntry[], timezoneOffset: number, mentionUser: boolean) {
  const lines = [
    '【家园提醒】检测到未拾取蛋或成熟作物',
    `检查时间：${formatDateTime(Date.now(), timezoneOffset)}`,
  ]

  entries.forEach((entry, index) => {
    lines.push(formatEntry(entry, index, mentionUser))
  })

  return lines.join('\n')
}

function formatEntry(entry: HomeAlertEntry, index: number, mentionUser: boolean) {
  const label = mentionUser
    ? h.at(entry.binding.userId).toString()
    : entry.binding.username || entry.binding.userId
  const parts = [
    `${index + 1}. ${label} UID ${entry.binding.uid}`,
    entry.eggs.length ? `待拾取蛋 ${entry.eggs.length} 个：${formatEggs(entry.eggs)}` : '',
    entry.ripePlots.length ? `成熟作物 ${entry.ripePlots.length} 块：${formatPlots(entry.ripePlots)}` : '',
    entry.result.origin === 'stale' ? '旧缓存回退' : '',
  ].filter(Boolean)

  return parts.join(' | ')
}

function formatEggs(eggs: HomePet[]) {
  return formatLimited(eggs.map(pet => `${pet.name || '未知精灵'}的蛋`))
}

function formatPlots(plots: HomePlot[]) {
  return formatLimited(plots.map(getHomePlotName))
}

function formatLimited(values: string[]) {
  const visible = values.slice(0, MAX_DETAIL_ITEMS)
  if (values.length > MAX_DETAIL_ITEMS) {
    visible.push(`等 ${values.length} 项`)
  }
  return visible.join('，')
}
