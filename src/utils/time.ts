import { DEFAULT_SCHEDULE_HOURS, HOUR } from '../constants'

export function normalizeScheduleHours(hours: number[]) {
  const result = Array.from(new Set(
    (Array.isArray(hours) ? hours : [])
      .filter(value => Number.isInteger(value) && value >= 0 && value <= 23),
  )).sort((a, b) => a - b)

  return result.length ? result : DEFAULT_SCHEDULE_HOURS
}

export function getNextScheduleTime(now: Date, scheduleHours: number[], timezoneOffset: number) {
  const candidates = [
    ...getScheduleTimesForDate(now, scheduleHours, timezoneOffset),
    ...getScheduleTimesForDate(new Date(now.getTime() + 24 * HOUR), scheduleHours, timezoneOffset),
  ].sort((a, b) => a.getTime() - b.getTime())

  const next = candidates.find(candidate => candidate.getTime() > now.getTime() + 1000)
  return next || new Date(now.getTime() + HOUR)
}

export function getLastScheduleTime(now: Date, scheduleHours: number[], timezoneOffset: number) {
  const candidates = [
    ...getScheduleTimesForDate(new Date(now.getTime() - 24 * HOUR), scheduleHours, timezoneOffset),
    ...getScheduleTimesForDate(now, scheduleHours, timezoneOffset),
  ].sort((a, b) => a.getTime() - b.getTime())

  const last = [...candidates].reverse().find(candidate => candidate.getTime() <= now.getTime())
  return last || new Date(now.getTime() - HOUR)
}

export function getScheduleTimesForDate(baseDate: Date, scheduleHours: number[], timezoneOffset: number) {
  const zoned = shiftToTimezone(baseDate, timezoneOffset)
  const year = zoned.getUTCFullYear()
  const month = zoned.getUTCMonth()
  const day = zoned.getUTCDate()

  return scheduleHours.map(hour => createTimezoneDate(year, month, day, hour, 0, timezoneOffset))
}

export function createTimezoneDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezoneOffset: number,
) {
  const dayOffset = Math.floor(hour / 24)
  const normalizedHour = ((hour % 24) + 24) % 24
  return new Date(Date.UTC(year, month, day, normalizedHour, minute, 0, 0) - timezoneOffset * HOUR + dayOffset * 24 * HOUR)
}

export function shiftToTimezone(value: Date | number | string, timezoneOffset: number) {
  const date = new Date(value)
  return new Date(date.getTime() + timezoneOffset * HOUR)
}

export function formatScheduleKey(value: Date | number | string, timezoneOffset: number) {
  const zoned = shiftToTimezone(value, timezoneOffset)
  return [
    zoned.getUTCFullYear(),
    pad(zoned.getUTCMonth() + 1),
    pad(zoned.getUTCDate()),
    pad(zoned.getUTCHours()),
  ].join('-')
}

export function formatDateOnly(value: Date | number | string, timezoneOffset: number) {
  const zoned = shiftToTimezone(value, timezoneOffset)
  return `${zoned.getUTCFullYear()}-${pad(zoned.getUTCMonth() + 1)}-${pad(zoned.getUTCDate())}`
}

export function formatDateTime(value: Date | number | string, timezoneOffset: number) {
  const zoned = shiftToTimezone(value, timezoneOffset)
  return `${formatDateOnly(zoned, 0)} ${pad(zoned.getUTCHours())}:${pad(zoned.getUTCMinutes())}:${pad(zoned.getUTCSeconds())}`
}

export function formatCountdown(diffMs: number) {
  if (!Number.isFinite(diffMs)) return ''
  if (diffMs <= 0) return '已结束'

  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  if (minutes > 0) {
    return `${minutes}分钟`
  }
  return `${seconds}秒`
}

export function parseHourMinute(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null
  }

  return { hour, minute }
}

export function buildSlotWindow(baseValue: Date | number | string, start: string, end: string, timezoneOffset: number) {
  const startTime = parseHourMinute(start)
  const endTime = parseHourMinute(end)
  if (!startTime || !endTime) {
    return {}
  }

  const zoned = shiftToTimezone(baseValue, timezoneOffset)
  const year = zoned.getUTCFullYear()
  const month = zoned.getUTCMonth()
  const day = zoned.getUTCDate()

  const startDate = createTimezoneDate(year, month, day, startTime.hour, startTime.minute, timezoneOffset)
  let endDate = createTimezoneDate(year, month, day, endTime.hour, endTime.minute, timezoneOffset)
  if (endDate.getTime() <= startDate.getTime()) {
    endDate = new Date(endDate.getTime() + 24 * HOUR)
  }

  return {
    startTime: startDate.getTime(),
    endTime: endDate.getTime(),
  }
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}
