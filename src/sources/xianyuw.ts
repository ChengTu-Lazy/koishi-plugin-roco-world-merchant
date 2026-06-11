import { Context } from 'koishi'

import { Config, MerchantApiResponse } from '../types'

export function hasBackupSource(config: Config) {
  return Boolean(config.apiKey.trim())
}

export function buildBackupApiUrl(config: Config, format: 'json' | 'img') {
  const url = new URL(config.apiBaseUrl)
  url.searchParams.set('key', config.apiKey)
  url.searchParams.set('format', format)
  url.searchParams.set('refresh', config.refreshValue ?? '')
  return url.toString()
}

export async function fetchBackupJsonData(ctx: Context, config: Config) {
  if (!hasBackupSource(config)) {
    throw new Error('未配置咸鱼备用数据源 apiKey')
  }

  const response = await ctx.http.get(buildBackupApiUrl(config, 'json'), {
    timeout: config.requestTimeout,
  }) as MerchantApiResponse

  if (!response || response.code !== 200 || !response.data) {
    throw new Error(`咸鱼备用 JSON 接口返回异常：${response?.msg || response?.code || 'unknown'}`)
  }

  return response.data
}

export async function fetchBackupImageData(ctx: Context, config: Config) {
  if (!hasBackupSource(config)) {
    throw new Error('未配置咸鱼备用数据源 apiKey')
  }

  const raw = await ctx.http.get(buildBackupApiUrl(config, 'img'), {
    timeout: config.requestTimeout,
    responseType: 'arraybuffer',
  }) as ArrayBuffer

  return Buffer.from(raw)
}
