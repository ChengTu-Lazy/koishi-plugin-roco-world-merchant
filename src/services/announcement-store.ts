import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Context, Logger } from 'koishi'

import { fetchAnnouncementData } from '../sources/announcement'
import { AnnouncementFetchOptions } from '../sources/announcement'
import { AnnouncementData, Config } from '../types'
import { formatError } from '../utils/error'

interface AnnouncementState {
  cache?: AnnouncementData
  lastPushedKey?: string
  lastSignature?: string
}

export interface AnnouncementStoreOptions {
  ctx: Context
  logger: Logger
  config: Config
  stateFile: string
}

export class AnnouncementStore {
  private state: AnnouncementState = {}

  constructor(private readonly options: AnnouncementStoreOptions) {}

  async init() {
    this.state = await loadAnnouncementState(this.options.stateFile, this.options.logger)
  }

  get lastPushedKey() {
    return this.state.lastPushedKey
  }

  get lastSignature() {
    return this.state.lastSignature
  }

  async fetchLatest(options: AnnouncementFetchOptions = {}) {
    const mode = this.options.config.announcementPush?.mode || 'both'
    const data = await fetchAnnouncementData(this.options.ctx, this.options.config, mode, options)
    this.state.cache = data
    await this.persist()
    return data
  }

  async rememberPush(scheduleKey: string, signature: string) {
    this.state.lastPushedKey = scheduleKey
    this.state.lastSignature = signature
    await this.persist()
  }

  private async persist() {
    await mkdir(dirname(this.options.stateFile), { recursive: true })
    await writeFile(this.options.stateFile, JSON.stringify(this.state, null, 2), 'utf8')
  }
}

export function createAnnouncementSignature(data: AnnouncementData) {
  return data.items
    .map(item => [
      item.type,
      item.id || item.title,
      item.publishedAt || '',
      item.startAt || '',
      item.endAt || '',
      item.time || '',
      item.urgent ? 'urgent' : '',
      item.status || '',
      item.summary || '',
      (item.imageUrls || []).join(','),
    ].join(':'))
    .join('|')
}

async function loadAnnouncementState(file: string, logger: Logger): Promise<AnnouncementState> {
  try {
    const content = await readFile(file, 'utf8')
    return JSON.parse(content) as AnnouncementState
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`读取公告/活动状态失败：${formatError(error)}`)
    }
    return {}
  }
}
