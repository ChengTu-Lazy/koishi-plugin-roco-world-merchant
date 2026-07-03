import { ARKMENG_BASE_URL } from '../constants'

export function buildArkmengPlantIconUrl(name: string | undefined) {
  const normalizedName = name?.trim()
  if (!normalizedName) return undefined

  const encodedPath = `/storage/files/图片/道具/${normalizedName}.png`
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
  return `${ARKMENG_BASE_URL}${encodedPath}`
}
