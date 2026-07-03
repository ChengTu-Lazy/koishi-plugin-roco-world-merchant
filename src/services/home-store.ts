import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Context, Logger } from 'koishi'

import { hasMagicBookSource } from '../sources/magicbook'
import { fetchArkmengHomeInfo, fetchMagicBookHomeInfo } from '../sources/home'
import { Config, HomeBinding, HomeQueryData, HomeQueryResult, HomeSourceName } from '../types'
import { formatError } from '../utils/error'

interface RememberedUid {
  uid: string
  updatedAt: number
}

interface HomeCacheEntry extends HomeQueryData {
  cachedAt: number
}

interface HomeStoreState {
  rememberedUids?: Record<string, RememberedUid>
  caches?: Record<string, HomeCacheEntry>
  bindings?: Record<string, HomeBinding>
  lastCheckedScheduleKey?: string
  lastCheckedAt?: number
}

export interface HomeStoreOptions {
  ctx: Context
  logger: Logger
  config: Config
  stateFile: string
}

export class HomeStore {
  private state: HomeStoreState = {}

  constructor(private readonly options: HomeStoreOptions) {}

  async init() {
    this.state = await loadHomeState(this.options.stateFile, this.options.logger)
  }

  getRememberedUid(key: string) {
    return this.state.rememberedUids?.[key]?.uid || ''
  }

  getBoundUid(session: any) {
    const key = getSessionBindingKey(session)
    return key ? this.state.bindings?.[key]?.uid || '' : ''
  }

  getBinding(session: any) {
    const key = getSessionBindingKey(session)
    return key ? this.state.bindings?.[key] || null : null
  }

  listBindings() {
    return Object.values(this.state.bindings || {})
  }

  get lastCheckedScheduleKey() {
    return this.state.lastCheckedScheduleKey
  }

  async rememberUid(key: string, uid: string) {
    this.state.rememberedUids ||= {}
    this.state.rememberedUids[key] = {
      uid,
      updatedAt: Date.now(),
    }
    trimRecord(this.state.rememberedUids, 500)
    await this.persist()
  }

  async bindSession(session: any, uid: string) {
    const binding = createSessionBinding(session, uid)
    this.state.bindings ||= {}
    this.state.bindings[binding.key] = binding
    trimRecord(this.state.bindings, 500)
    await this.persist()
    return binding
  }

  async unbindSession(session: any) {
    const key = getSessionBindingKey(session)
    if (!key || !this.state.bindings?.[key]) {
      return null
    }

    const binding = this.state.bindings[key]
    delete this.state.bindings[key]
    await this.persist()
    return binding
  }

  async rememberHomeCheck(scheduleKey: string) {
    this.state.lastCheckedScheduleKey = scheduleKey
    this.state.lastCheckedAt = Date.now()
    await this.persist()
  }

  async query(uid: string, options: { forceRefresh?: boolean } = {}): Promise<HomeQueryResult> {
    const cached = options.forceRefresh ? null : this.getUsableCache(uid)
    if (cached) {
      return {
        uid: cached.uid,
        fetchedAt: cached.fetchedAt,
        home: cached.home,
        origin: 'cache',
      }
    }

    let data: HomeQueryData
    try {
      data = await this.fetchHomeData(uid)
    } catch (error) {
      const stale = this.state.caches?.[uid]
      if (stale) {
        return {
          uid: stale.uid,
          fetchedAt: stale.fetchedAt,
          home: stale.home,
          origin: 'stale',
          warning: `洛克万事屋本次未获取到最新家园数据，已回退到旧缓存：${formatError(error)}`,
        }
      }
      throw error
    }

    this.state.caches ||= {}
    this.state.caches[uid] = {
      ...data,
      cachedAt: Date.now(),
    }
    trimRecord(this.state.caches, 100)
    await this.persist()

    return {
      ...data,
      origin: 'live',
    }
  }

  private async fetchHomeData(uid: string) {
    const { ctx, config, logger } = this.options
    const errors: string[] = []
    const preferredSource = getHomePreferredSource(config.homePreferredSource)

    for (const source of getHomeSourceOrder(preferredSource)) {
      try {
        if (source === 'magicbook') {
          if (!hasMagicBookSource(config)) {
            if (preferredSource === 'magicbook') {
              logger.warn('当前家园查询默认源为洛克魔法书，但未配置 rocomApiKey，已自动跳过魔法书源。')
            }
            continue
          }
          return await fetchMagicBookHomeInfo(ctx, config, uid)
        }

        return await fetchArkmengHomeInfo(ctx, config, uid)
      } catch (error) {
        const label = source === 'magicbook' ? '洛克魔法书家园接口' : '洛克万事屋家园接口'
        const message = `${label}失败：${formatError(error)}`
        errors.push(message)
        logger.warn(message)
      }
    }

    if (!errors.length && preferredSource === 'magicbook') {
      errors.push('洛克魔法书家园接口未配置 rocomApiKey，无法请求')
    }

    throw new Error(errors.join('；') || '所有家园数据源均不可用')
  }

  private getUsableCache(uid: string) {
    const cache = this.state.caches?.[uid]
    if (!cache) return null

    const ttl = Math.max(0, this.options.config.homeQueryCacheMinutes ?? 5) * 60 * 1000
    if (!ttl || Date.now() - cache.cachedAt > ttl) {
      return null
    }

    return cache
  }

  private async persist() {
    await mkdir(dirname(this.options.stateFile), { recursive: true })
    await writeFile(this.options.stateFile, JSON.stringify(this.state, null, 2), 'utf8')
  }
}

async function loadHomeState(file: string, logger: Logger): Promise<HomeStoreState> {
  try {
    const content = await readFile(file, 'utf8')
    return JSON.parse(content) as HomeStoreState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`读取家园查询状态失败：${formatError(error)}`)
    }
    return {}
  }
}

function trimRecord<T extends { updatedAt?: number, cachedAt?: number }>(record: Record<string, T>, maxSize: number) {
  const keys = Object.keys(record)
  if (keys.length <= maxSize) return

  keys
    .sort((left, right) => getRecordTime(record[left]) - getRecordTime(record[right]))
    .slice(0, keys.length - maxSize)
    .forEach(key => delete record[key])
}

function getRecordTime(value: { updatedAt?: number, cachedAt?: number }) {
  return value.updatedAt || value.cachedAt || 0
}

function getHomePreferredSource(source: unknown): HomeSourceName {
  return source === 'magicbook' ? 'magicbook' : 'arkmeng'
}

function getHomeSourceOrder(source: HomeSourceName): HomeSourceName[] {
  return source === 'magicbook'
    ? ['magicbook', 'arkmeng']
    : ['arkmeng', 'magicbook']
}

function createSessionBinding(session: any, uid: string): HomeBinding {
  const key = getSessionBindingKey(session)
  if (!key) {
    throw new Error('请在群聊中绑定家园 UID，且需要能读取到用户 ID 和群/频道 ID。')
  }

  return {
    key,
    uid,
    platform: readSessionString(session?.platform) || 'unknown',
    channelId: readSessionString(session?.channelId),
    guildId: readSessionString(session?.guildId) || undefined,
    userId: readSessionString(session?.userId),
    username: readSessionString(session?.username) || readSessionString(session?.author?.name) || undefined,
    updatedAt: Date.now(),
  }
}

function getSessionBindingKey(session: any) {
  const platform = readSessionString(session?.platform) || 'unknown'
  const channelId = readSessionString(session?.channelId)
  const userId = readSessionString(session?.userId)
  if (!channelId || !userId) return ''
  return `${platform}:channel:${channelId}:user:${userId}`
}

function readSessionString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
