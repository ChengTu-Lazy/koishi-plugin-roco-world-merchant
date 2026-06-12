export type OutputMode = 'text' | 'image' | 'both'
export type SourceName = 'onebiji' | 'xianyuw'

export interface ScheduleTime {
  hour: number
  minute: number
}

export interface PushTarget {
  name?: string
  platform: string
  selfId: string
  channelId: string
  guildId?: string
}

export interface WatchConfig {
  enabled: boolean
  items: string[]
  mentionAllOnMatch: boolean
}

export interface Config {
  primarySourceUrl: string
  preferredSource: SourceName
  apiKey: string
  apiBaseUrl: string
  refreshValue: string
  outputMode: OutputMode
  commandName: string
  commandAliases: string[]
  timezoneOffset: number
  scheduleTimes?: string[]
  scheduleHours?: number[]
  pushTargets: PushTarget[]
  requestTimeout: number
  pushOnStartupIfMissed: boolean
  startupCatchupWindowMinutes: number
  watch: WatchConfig
}

export interface MerchantRound {
  current?: number
  total?: number
  status?: string
  label?: string
  countdown?: string
}

export interface MerchantItem {
  name?: string
  kind?: string
  image?: string
  start_time?: number
  end_time?: number
  time_label?: string
  countdown?: string
  price?: number
  limit?: number
  status?: string
}

export interface MerchantData {
  merchant_name?: string
  subtitle?: string
  fetched_at?: string
  round?: MerchantRound
  item_count?: number
  items?: MerchantItem[]
}

export interface MerchantApiResponse {
  code: number
  msg?: string
  data?: MerchantData
  powered_by?: string
}

export interface CacheEntry {
  slotKey: string
  expiresAt: number
  fetchedAt: number
  source: SourceName
  data: MerchantData
  imageBase64?: string
  imageMimeType?: string
  imageVersion?: string
}

export interface PersistedState {
  cache?: CacheEntry
  sourcePreference?: SourceName
  lastPushedScheduleKey?: string
  lastPushedAt?: number
}

export interface CacheResult {
  entry: CacheEntry | null
  origin: 'cache' | 'live' | 'stale'
  warning?: string
}

export interface PrimarySlot {
  index: number
  start: string
  end: string
  label: string
  active: boolean
}
