import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Context, Logger } from 'koishi'

import { fetchArkmengHomeInfo } from '../sources/home'
import { Config, HomeQueryData, HomeQueryResult } from '../types'
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

  async rememberUid(key: string, uid: string) {
    this.state.rememberedUids ||= {}
    this.state.rememberedUids[key] = {
      uid,
      updatedAt: Date.now(),
    }
    trimRecord(this.state.rememberedUids, 500)
    await this.persist()
  }

  async query(uid: string): Promise<HomeQueryResult> {
    const cached = this.getUsableCache(uid)
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
      data = await fetchArkmengHomeInfo(this.options.ctx, this.options.config, uid)
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
    trimRecord(this.state.caches, 20)
    await this.persist()

    return {
      ...data,
      origin: 'live',
    }
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
