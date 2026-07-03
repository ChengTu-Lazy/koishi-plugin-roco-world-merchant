import { Context } from 'koishi'

import { ROCOM_API_BASE_URL } from '../constants'
import { Config } from '../types'
import { parseInteger } from '../utils/parse'

const ROCOM_API_USER_AGENT = 'koishi-plugin-roco-world-merchant'

export async function callRocomApi(
  ctx: Context,
  config: Config,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
) {
  const apiKey = config.rocomApiKey?.trim()
  if (!apiKey) {
    throw new Error('未配置洛克魔法书 API Key（rocomApiKey）')
  }

  const url = new URL(path, config.rocomApiBaseUrl || ROCOM_API_BASE_URL)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await ctx.http.get(url.toString(), {
    timeout: config.requestTimeout,
    headers: {
      'X-API-Key': apiKey,
      'User-Agent': ROCOM_API_USER_AGENT,
    },
  })

  const root = asRecord(response)
  const code = parseInteger(root.code)
  if (code != null && code !== 0 && code !== 200) {
    throw new Error(readString(root.message) || readString(root.error) || `接口返回错误码 ${code}`)
  }

  return root.data !== undefined ? parseMaybeJson(root.data) : response
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
