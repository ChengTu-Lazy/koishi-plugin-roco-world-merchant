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
    const guessedMimeType = guessImageMimeType(url)
    const file = this.getCacheFile(url, guessedMimeType)
    let buffer = await readFile(file).catch(() => null)
    let mimeType = buffer ? detectImageMimeType(buffer) : undefined

    if (!buffer || !mimeType) {
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
      mimeType = detectImageMimeType(buffer) || guessedMimeType
      if (!mimeType) {
        throw new Error('unsupported image format')
      }
      await mkdir(this.options.cacheDir, { recursive: true })
      await writeFile(file, buffer)
    }

    if (buffer.length > MAX_ASSET_BYTES) {
      throw new Error(`cached image too large: ${buffer.length} bytes`)
    }

    mimeType ||= guessedMimeType
    if (!mimeType) {
      throw new Error('unsupported image format')
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
  try {
    const format = new URL(url).searchParams.get('wx_fmt')?.toLowerCase()
    if (format === 'jpg' || format === 'jpeg') return 'image/jpeg'
    if (format === 'webp') return 'image/webp'
    if (format === 'gif') return 'image/gif'
    if (format === 'svg') return 'image/svg+xml'
    if (format === 'png') return 'image/png'
  } catch {
    // 由文件内容继续识别。
  }
  return undefined
}

function getExtension(url: string, mimeType?: string) {
  const ext = extname(safeUrlPathname(url)).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
    return ext
  }
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.img'
}

function detectImageMimeType(buffer: Buffer) {
  if (buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a) {
    return 'image/png'
  }

  if (buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return 'image/gif'
    }
  }

  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }

  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }

  const text = buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) {
    return 'image/svg+xml'
  }

  return undefined
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
