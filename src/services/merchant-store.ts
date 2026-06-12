import { Context, Logger } from 'koishi'

import { createCacheEntry, getUsableCache, loadState, persistState } from '../cache'
import { IMAGE_RENDER_VERSION } from '../constants'
import { ItemIconMap, renderSvgImage } from '../render/image'
import { renderPngWithPuppeteer } from '../render/puppeteer'
import { fetchPrimaryHtml, parsePrimaryHtml } from '../sources/onebiji'
import { fetchBackupImageData, fetchBackupJsonData, hasBackupSource } from '../sources/xianyuw'
import { CacheEntry, CacheResult, Config, MerchantData, PersistedState, ScheduleTime, SourceName } from '../types'
import { formatError } from '../utils/error'
import { isPngBase64 } from '../utils/image'

export interface MerchantStoreOptions {
  ctx: Context
  logger: Logger
  config: Config
  stateFile: string
  scheduleTimes: ScheduleTime[]
}

interface SourceAttempt {
  source: SourceName
  label: string
  fetch: () => Promise<MerchantData>
}

export class MerchantStore {
  private state: PersistedState = {}
  private refreshPromise: Promise<CacheEntry> | null = null

  constructor(private readonly options: MerchantStoreOptions) {}

  async init() {
    this.state = await loadState(this.options.stateFile, this.options.logger)
  }

  get lastPushedScheduleKey() {
    return this.state.lastPushedScheduleKey
  }

  async rememberPush(scheduleKey: string) {
    this.state.lastPushedScheduleKey = scheduleKey
    this.state.lastPushedAt = Date.now()
    await this.persist()
  }

  async getCache(requireImage: boolean, forceRefresh: boolean): Promise<CacheResult> {
    const cached = !forceRefresh ? this.getUsableCacheForPreference() : null
    if (cached) {
      if (requireImage) {
        await this.ensureImage(cached)
      }
      return {
        entry: cached,
        origin: 'cache',
      }
    }

    try {
      const entry = await this.refreshCache(requireImage, forceRefresh)
      return {
        entry,
        origin: 'live',
      }
    } catch (error) {
      const message = formatError(error)
      this.options.logger.warn(`获取远行商人数据失败：${message}`)

      if (this.state.cache) {
        if (requireImage) {
          await this.ensureImage(this.state.cache)
        }
        return {
          entry: this.state.cache,
          origin: 'stale',
          warning: `所有可用数据源请求均失败，已回退到旧缓存：${message}`,
        }
      }

      return {
        entry: null,
        origin: 'live',
        warning: `所有可用数据源请求均失败：${message}`,
      }
    }
  }

  private async refreshCache(requireImage: boolean, forceRefresh: boolean) {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        const preferredSource = this.getPreferredSource()
        const entry = await this.fetchPreferredEntry(forceRefresh)
        this.state.cache = entry
        this.state.sourcePreference = preferredSource
        await this.persist()
        return entry
      })().finally(() => {
        this.refreshPromise = null
      })
    }

    const entry = await this.refreshPromise
    if (requireImage) {
      await this.ensureImage(entry)
    }
    return entry
  }

  private async fetchPreferredEntry(forceRefresh: boolean) {
    const { config, logger, scheduleTimes } = this.options
    const errors: string[] = []
    const previous = forceRefresh ? undefined : this.state.cache
    const attempts = this.getSourceAttempts(this.getPreferredSource())

    for (const attempt of attempts) {
      try {
        const data = await attempt.fetch()
        return createCacheEntry(data, attempt.source, previous, scheduleTimes, config.timezoneOffset)
      } catch (error) {
        const message = `${attempt.label}失败：${formatError(error)}`
        errors.push(message)
        logger.warn(message)
      }
    }

    if (!hasBackupSource(config)) {
      errors.push('备用数据源咸鱼未配置 apiKey，无法切换到备用源')
    }

    throw new Error(errors.join('；'))
  }

  private getSourceAttempts(preferredSource: SourceName): SourceAttempt[] {
    const { ctx, config, logger } = this.options
    const order = [preferredSource, getAlternateSource(preferredSource)] as SourceName[]
    const attempts: SourceAttempt[] = []

    for (const source of order) {
      if (source === 'onebiji') {
        attempts.push({
          source,
          label: '主数据源 onebiji',
          fetch: async () => {
            const html = await fetchPrimaryHtml(ctx, config)
            return parsePrimaryHtml(html, config.timezoneOffset)
          },
        })
        continue
      }

      if (source === 'xianyuw' && hasBackupSource(config)) {
        attempts.push({
          source,
          label: '备用数据源咸鱼',
          fetch: async () => fetchBackupJsonData(ctx, config),
        })
      }
    }

    if (preferredSource === 'xianyuw' && !hasBackupSource(config)) {
      logger.warn('当前默认数据源为咸鱼源，但未配置 apiKey，已自动回退到 onebiji 主源。')
    }

    return attempts
  }

  private getUsableCacheForPreference() {
    const cached = getUsableCache(this.state)
    if (!cached) {
      return null
    }

    const cachedPreference = this.state.sourcePreference || cached.source
    if (cachedPreference !== this.getPreferredSource()) {
      return null
    }

    return cached
  }

  private getPreferredSource(): SourceName {
    return this.options.config.preferredSource === 'xianyuw' ? 'xianyuw' : 'onebiji'
  }

  private async ensureImage(entry: CacheEntry) {
    if (
      entry.imageBase64
      && entry.imageVersion === IMAGE_RENDER_VERSION
      && entry.imageMimeType === 'image/png'
      && isPngBase64(entry.imageBase64)
    ) {
      return entry
    }

    let imageBuffer: Buffer | null = null
    let mimeType = 'image/png'

    if (entry.source === 'xianyuw' && hasBackupSource(this.options.config)) {
      try {
        imageBuffer = await fetchBackupImageData(this.options.ctx, this.options.config)
        mimeType = 'image/png'
      } catch (error) {
        this.options.logger.warn(`备用图片获取失败，改用卡片 PNG 渲染：${formatError(error)}`)
      }
    }

    if (!imageBuffer) {
      const itemIcons = await this.loadItemIcons(entry)
      const svgImage = renderSvgImage(
        entry.data,
        entry.source,
        this.options.config.timezoneOffset,
        entry.fetchedAt,
        itemIcons,
      )

      try {
        imageBuffer = await renderPngWithPuppeteer(this.options.ctx, svgImage)
        mimeType = 'image/png'
      } catch (error) {
        this.options.logger.warn(`卡片图片渲染失败，改用纯文字消息：${formatError(error)}`)
        entry.imageBase64 = undefined
        entry.imageMimeType = undefined
        entry.imageVersion = undefined
        this.state.cache = entry
        await this.persist()
        return entry
      }
    }

    entry.imageBase64 = imageBuffer.toString('base64')
    entry.imageMimeType = mimeType
    entry.imageVersion = IMAGE_RENDER_VERSION
    this.state.cache = entry
    await this.persist()
    return entry
  }

  private async persist() {
    await persistState(this.options.stateFile, this.state)
  }

  private async loadItemIcons(entry: CacheEntry) {
    const items = Array.isArray(entry.data.items) ? entry.data.items : []
    const iconEntries = await Promise.all(items.map(async (item) => {
      if (!item.image) {
        return null
      }

      try {
        const raw = await this.options.ctx.http.get(item.image, {
          timeout: this.options.config.requestTimeout,
          responseType: 'arraybuffer',
        }) as ArrayBuffer
        const mimeType = guessImageMimeType(item.image)
        const dataUri = `data:${mimeType};base64,${Buffer.from(raw).toString('base64')}`
        return [item.image, dataUri] as const
      } catch (error) {
        const itemLabel = item.name || item.image
        this.options.logger.warn(`商品图标获取失败：${itemLabel}，改用占位显示：${formatError(error)}`)
        return null
      }
    }))

    return Object.fromEntries(iconEntries.filter(Boolean)) as ItemIconMap
  }
}

function getAlternateSource(source: SourceName): SourceName {
  return source === 'onebiji' ? 'xianyuw' : 'onebiji'
}

function guessImageMimeType(url: string) {
  const cleanedUrl = url.split('?')[0].toLowerCase()
  if (cleanedUrl.endsWith('.jpg') || cleanedUrl.endsWith('.jpeg')) return 'image/jpeg'
  if (cleanedUrl.endsWith('.webp')) return 'image/webp'
  if (cleanedUrl.endsWith('.gif')) return 'image/gif'
  if (cleanedUrl.endsWith('.svg')) return 'image/svg+xml'
  return 'image/png'
}
