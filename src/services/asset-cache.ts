import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { Context, Logger } from 'koishi'

import { Config } from '../types'
import { formatError } from '../utils/error'

const IMAGE_HREF_PATTERN = /<image\b[^>]*?\s(?:href|xlink:href)=["'](https?:\/\/[^"']+)["']/g
const MAX_ASSET_BYTES = 5 * 1024 * 1024

export interface AssetCacheOptions {
  ctx: Context
  logger: Logger
  config: Config
  cacheDir: string
}

export class AssetCache {
  constructor(private readonly options: AssetCacheOptions) {}

  async inlineSvgImages(svg: string) {
    const hrefs = Array.from(new Set(
      [...svg.matchAll(IMAGE_HREF_PATTERN)]
        .map(match => match[1])
        .filter(Boolean),
    ))

    if (!hrefs.length) {
      return svg
    }

    const entries = await Promise.all(hrefs.map(async (href) => {
      const url = decodeXmlAttribute(href)
      try {
        const dataUri = await this.getImageDataUri(url)
        return [href, dataUri] as const
      } catch (error) {
        this.options.logger.warn(`图片素材缓存失败：${url} -> ${formatError(error)}`)
        return null
      }
    }))

    let inlined = svg
    for (const entry of entries) {
      if (!entry) continue
      const [href, dataUri] = entry
      inlined = inlined.split(href).join(dataUri)
    }

    return inlined
  }

  private async getImageDataUri(url: string) {
    const mimeType = guessImageMimeType(url)
    const file = this.getCacheFile(url, mimeType)
    let buffer = await readFile(file).catch(() => null)

    if (!buffer) {
      const raw = await this.options.ctx.http.get(url, {
        timeout: this.options.config.requestTimeout,
        responseType: 'arraybuffer',
      }) as ArrayBuffer
      buffer = Buffer.from(raw)
      if (!buffer.length) {
        throw new Error('empty image response')
      }
      if (buffer.length > MAX_ASSET_BYTES) {
        throw new Error(`image too large: ${buffer.length} bytes`)
      }
      await mkdir(this.options.cacheDir, { recursive: true })
      await writeFile(file, buffer)
    }

    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  private getCacheFile(url: string, mimeType: string) {
    const hash = createHash('sha1').update(url).digest('hex')
    return join(this.options.cacheDir, `${hash}${getExtension(url, mimeType)}`)
  }
}

function guessImageMimeType(url: string) {
  const path = safeUrlPathname(url)
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.svg') return 'image/svg+xml'
  return 'image/png'
}

function getExtension(url: string, mimeType: string) {
  const ext = extname(safeUrlPathname(url)).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
    return ext
  }
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.png'
}

function safeUrlPathname(url: string) {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function decodeXmlAttribute(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}
