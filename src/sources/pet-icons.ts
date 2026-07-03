import { ARKMENG_BASE_URL } from '../constants'

export function resolvePetIconUrl(petCfgId: number | undefined, name: string | undefined) {
  if (petCfgId && petCfgId > 0) {
    return `https://game.gtimg.cn/images/rocom/rocodata/jingling/${petCfgId}/icon.png`
  }

  const normalizedName = name?.trim()
  return normalizedName ? buildArkmengPetIconUrl(normalizedName) : undefined
}

export function buildArkmengPetIconUrl(name: string) {
  const encodedPath = `/storage/files/图片/精灵/${name.trim()}.png`
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
  return `${ARKMENG_BASE_URL}${encodedPath}`
}
