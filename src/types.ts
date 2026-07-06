export type OutputMode = 'text' | 'image' | 'both'
export type SourceName = 'onebiji' | 'arkmeng' | 'magicbook' | 'xianyuw'
export type HomeSourceName = 'arkmeng' | 'magicbook'
export type AnnouncementPushMode = 'activities' | 'announcement' | 'both'

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

export interface AnnouncementPushConfig {
  enabled: boolean
  time: string
  mode: AnnouncementPushMode
  fetchDetails: boolean
  detailLimit: number
  onlyNotifyOnChange: boolean
}

export interface HomeCheckConfig {
  enabled: boolean
  mentionUser: boolean
  maxBindingsPerTarget: number
}

export interface Config {
  primarySourceUrl: string
  preferredSource: SourceName
  apiKey: string
  apiBaseUrl: string
  rocomApiKey: string
  rocomApiBaseUrl: string
  refreshValue: string
  outputMode: OutputMode
  commandName: string
  commandAliases: string[]
  homeQueryEnabled: boolean
  homePreferredSource: HomeSourceName
  homeCommandName: string
  homeCommandAliases: string[]
  homeQueryCacheMinutes: number
  timezoneOffset: number
  scheduleTimes?: string[]
  scheduleHours?: number[]
  pushTargets: PushTarget[]
  requestTimeout: number
  pushOnStartupIfMissed: boolean
  startupCatchupWindowMinutes: number
  watch: WatchConfig
  announcementPush: AnnouncementPushConfig
  homeCheck: HomeCheckConfig
}

export interface MerchantRound {
  current?: number
  total?: number
  status?: string
  start_time?: number
  end_time?: number
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
  dataVersion?: string
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

export interface HomeOverview {
  homeName?: string
  homeLevel?: number
  comfortLevel?: number
  experience?: number
}

export interface HomePet {
  name?: string
  petCfgId?: number
  iconUrl?: string
  level?: number
  gender?: number
  energy?: number
  feedRound?: number
  mutationType?: number
  mutationName?: string
  inspirationReadyAt?: number
  inspirationDuration?: number
  hasEgg?: boolean
  status?: number
}

export interface HomePlot {
  plotId?: number
  seedId?: number
  seedName?: string
  iconUrl?: string
  state?: number
  ripTime?: number
  growDuration?: number
  harvestNum?: number
  canStealCount?: number
  stealCount?: number
}

export interface HomeLand {
  plots?: HomePlot[]
}

export interface HomeInfo {
  overview?: HomeOverview
  pets?: HomePet[]
  lands?: HomeLand[]
  plantCount?: number
  plantUnlocked?: boolean
}

export interface HomeQueryData {
  uid: string
  fetchedAt: number
  home: HomeInfo
}

export interface HomeQueryResult extends HomeQueryData {
  origin: 'cache' | 'live' | 'stale'
  warning?: string
}

export interface HomeBinding {
  key: string
  uid: string
  platform: string
  channelId: string
  guildId?: string
  userId: string
  username?: string
  updatedAt: number
}

export interface AnnouncementItem {
  type: '公告' | '活动'
  id?: string
  detailId?: string
  title: string
  summary?: string
  publishedAt?: number
  startAt?: number
  endAt?: number
  time?: number
  url?: string
  imageUrls?: string[]
  urgent?: boolean
  status?: string
}

export interface AnnouncementData {
  fetchedAt: number
  mode: AnnouncementPushMode
  items: AnnouncementItem[]
  warnings?: string[]
}
