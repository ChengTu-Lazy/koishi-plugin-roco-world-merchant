import { ARKMENG_BASE_URL } from '../constants'

// 官方图标只覆盖 3xxx 正式编号；活动、首领、特殊编号（4xxx/8xxx/1800xxxx 等）的地址会返回 404。
export const OFFICIAL_PET_ICON_ID_MIN = 3000
export const OFFICIAL_PET_ICON_ID_MAX = 3999

export function resolvePetIconUrl(petCfgId: number | undefined, name: string | undefined) {
  if (petCfgId && petCfgId >= OFFICIAL_PET_ICON_ID_MIN && petCfgId <= OFFICIAL_PET_ICON_ID_MAX) {
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
