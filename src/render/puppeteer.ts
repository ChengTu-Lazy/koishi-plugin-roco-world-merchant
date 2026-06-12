import { Context } from 'koishi'

import { SvgImage } from './image'

export async function renderPngWithPuppeteer(ctx: Context, image: SvgImage) {
  const page = await ctx.puppeteer.page()

  try {
    await page.setViewport({
      width: Math.max(1, Math.ceil(image.width)),
      height: Math.max(1, Math.ceil(image.height)),
      deviceScaleFactor: 2,
    })

    await page.setContent(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }

      body {
        width: fit-content;
      }

      svg {
        display: block;
      }
    </style>
  </head>
  <body>${image.svg}</body>
</html>`)

    await page.evaluate(async () => {
      if ('fonts' in document) {
        await document.fonts.ready
      }
    })

    const handle = await page.$('svg')
    if (!handle) {
      throw new Error('failed to locate svg element for puppeteer screenshot')
    }

    const buffer = await handle.screenshot({
      type: 'png',
      omitBackground: true,
    })

    return Buffer.from(buffer)
  } finally {
    await page.close().catch(() => {})
  }
}
