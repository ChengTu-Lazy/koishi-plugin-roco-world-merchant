import { Context } from 'koishi'

import type { EggCard, EggResult } from '../services/egg-query'
import { Config } from '../types'
import { resolvePetIconUrl } from './pet-icons'

const EGG_LOOKUP_URL = 'https://roco.gptvip.chat/api/magic-egg-lookup'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function percentage(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 && result <= 100 ? result : undefined
}

// 这些独立系列没有可用于孵蛋的蛋组，不能作为查蛋结果展示。
function isNonBreedingPet(name: string) {
  return ['诅咒狼灵', '钨丝贝贝', '小帕尔'].some(keyword => name.includes(keyword))
}

export function parseBwikiEggResult(response: unknown, query: { height: number; weight: number }): EggResult {
  const root = record(response)
  if (root.ok !== true || !Array.isArray(root.matched)) throw new Error('BWIKI 查蛋接口返回失败或结构不正确')
  const cards = root.matched.map(value => {
    const item = record(value)
    const preview = record(item.pet_preview)
    const name = String(item.display_name || preview.display_name || '').trim()
    const id = String(item.base_id || '').trim()
    if (!name || !id) throw new Error('BWIKI 查蛋候选缺少名称或精灵 ID')
    const suppliedIcon = preview.avatar_url
    const icon = typeof suppliedIcon === 'string' && /^https?:\/\//i.test(suppliedIcon)
      ? suppliedIcon : resolvePetIconUrl(Number(id) || undefined, name)
    if (isNonBreedingPet(name)) return null
    return {
      id, name, icon, type: String(preview.type_name || '').replace(/元素精灵/g, '').replace(/,\s*/g, ' / '),
      height: '接口未提供', weight: '接口未提供',
      score: percentage(item.match_probability), scoreLabel: '参考概率',
      fitScore: percentage(item.fit_score), confidence: String(item.confidence_text || '未提供'),
      matchLabel: String(item.same_ride_label || '尺寸命中'),
    }
  }).filter(Boolean) as EggCard[]
  const lines = [`身高 ${query.height}m / 体重 ${query.weight}kg`, `匹配候选：${cards.length}只`]
  cards.forEach((card, index) => lines.push(
    `${index + 1}. ${card.name} #${card.id} · 参考概率 ${card.score == null ? '未提供' : `${card.score}%`}`,
    `  ${card.matchLabel === '尺寸命中' ? '尺寸命中' : card.matchLabel}`,
  ))
  if (!cards.length) lines.push('未找到符合当前尺寸的精灵。')
  const notice = '参考概率来自数据源估算，不代表实际孵出概率。'
  lines.push(notice, '数据源：BWIKI 工具站')
  return {
    title: '查蛋 · 尺寸反查', query, lines, source: 'BWIKI 工具站', notice,
    sections: [{ title: '匹配候选', total: cards.length, cards }],
  }
}

export async function fetchBwikiEgg(ctx: Context, config: Config, query: { height: number; weight: number }) {
  const url = new URL(EGG_LOOKUP_URL)
  url.searchParams.set('height_m', String(query.height))
  url.searchParams.set('weight_kg', String(query.weight))
  // 保留现有不指定蛋种的用法，不隐式限定为同乘或其他蛋池。
  const response = await ctx.http.get(url.toString(), { timeout: config.requestTimeout })
  return parseBwikiEggResult(response, query)
}
