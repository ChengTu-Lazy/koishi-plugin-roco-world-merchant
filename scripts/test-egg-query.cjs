require('esbuild-register')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseEggQuery, queryLocalEgg, queryEgg } = require('../src/services/egg-query.ts')
const { renderEggPages, eggResultText } = require('../src/render/egg.ts')
const { Context } = require('koishi')
const { eggRows } = require('../src/data/egg-data.ts')
const { eggFamilyRoots } = require('../src/data/egg-families.ts')
const { parseBwikiEggResult } = require('../src/sources/egg.ts')
const { resolvePetIconUrl } = require('../src/sources/pet-icons.ts')
const { AssetCache } = require('../src/services/asset-cache.ts')
const { sizeClassLabel, sizeClassNotes, petEggSizeRange } = require('../src/utils/egg-size.ts')
const bwikiFixture = require('./fixtures/bwiki-egg-027-3151.json')

async function main() {
  assert.deepEqual(parseEggQuery(['0.18', '1.5']), { height: 0.18, weight: 1.5 })
  assert.deepEqual(parseEggQuery(['身高0.18m', '体重1.5kg']), { height: 0.18, weight: 1.5 })
  assert.deepEqual(parseEggQuery(['体重1.5kg', '身高0.18m']), { height: 0.18, weight: 1.5 })
  assert.deepEqual(parseEggQuery(['0.18']), { height: 0.18, weight: undefined })
  assert.deepEqual(parseEggQuery(['1.5kg']), { height: undefined, weight: 1.5 })
  for (const args of [[], ['0'], ['-1'], ['NaN'], ['身高1kg'], ['身高abc'], ['1', '2', '3'], ['喵喵', '1']]) {
    assert.throws(() => parseEggQuery(args))
  }

  const name = queryLocalEgg({ name: '喵喵' })
  assert.match(eggResultText(name), /蛋组：陆上 \/ 人型/)
  assert.match(eggResultText(name), /0.23–0.31m/)
  // 家族数据必须自洽：键和最低阶都要在内置精灵里，最低阶自身不能再有进化前身。
  const rowIds = new Set(eggRows.map(row => row[0]))
  for (const [id, root] of Object.entries(eggFamilyRoots)) {
    assert.ok(rowIds.has(Number(id)), `家族数据包含未知精灵 ${id}`)
    assert.ok(rowIds.has(root), `家族数据缺少最低阶 ${root}`)
    assert.equal(eggFamilyRoots[root], undefined, `最低阶精灵 ${root} 不应再有进化前身`)
  }
  // 名称查询默认折叠同家族进化形态，只展示最低阶。
  const family = queryLocalEgg({ name: '阿米亚特' })
  const familyNames = family.sections[0].cards.map(card => card.name)
  assert.ok(!familyNames.includes('阿米樱'), '同家族进化形态不应出现在候选列表')
  assert.ok(!familyNames.includes('罗隐'), '同家族进化形态不应出现在候选列表')
  assert.match(eggResultText(family), /仅最低阶/)
  assert.match(renderEggPages(family)[0].svg, /仅最低阶/)
  const evolved = queryLocalEgg({ name: '罗隐' })
  assert.equal(evolved.pet.familyBase, '阿米亚特 #3014')
  assert.ok(evolved.sections[0].cards.some(card => card.name === '阿米亚特'), '查询进化形态时应保留家族最低阶')
  assert.ok(!evolved.sections[0].cards.some(card => card.name === '阿米樱'))
  assert.match(renderEggPages(evolved)[0].svg, /家族最低阶：阿米亚特 #3014/)

  // 同名重复行取正式编号：嘟嘟煲有 3367 与 18000004 两条，后者蛋组为空且官方图标 404。
  assert.match(resolvePetIconUrl(3003, '火花'), /jingling\/3003\/icon\.png$/)
  assert.match(resolvePetIconUrl(18000004, '嘟嘟煲'), /arkmeng\.cn\/.*%E5%98%9F%E5%98%9F%E7%85%B2\.png$/)
  assert.equal(resolvePetIconUrl(undefined, undefined), undefined)
  const duplicated = queryLocalEgg({ name: '嘟嘟煲' })
  assert.equal(duplicated.pet.id, '3367')
  assert.match(duplicated.pet.icon, /jingling\/3367\/icon\.png$/)
  const wolf = queryLocalEgg({ name: '恶魔狼' })
  assert.equal(wolf.pet.id, '3011')
  assert.ok(wolf.sections[0].total > 0, '正式编号记录应有蛋组与可配种精灵')

  // 图片素材取不到时删除 <image>，保留文字占位，避免卡片画出破图图标。
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'egg-asset-'))
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const assetCache = new AssetCache({
    ctx: { http: { async get(url) {
      if (url.includes('broken')) throw new Error('模拟 404')
      return pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)
    } } },
    logger: { warn() {} }, config: { requestTimeout: 100 }, cacheDir,
  })
  try {
    const inlined = await assetCache.inlineSvgImages('<svg><image href="https://ok.test/a.png" width="10" height="10"/><text>火</text><image href="https://bad.test/broken.png" width="10" height="10"/></svg>')
    assert.match(inlined, /data:image\/png;base64,/)
    assert.doesNotMatch(inlined, /broken\.png|<image[^>]*bad\.test/)
    assert.match(inlined, /<text>火<\/text>/)
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
  const size = queryLocalEgg({ height: 0.27, weight: 1.5 })
  assert.match(eggResultText(size), /喵喵 #3001 · 匹配度 100%/)
  const catCard = size.sections.flatMap(section => section.cards).find(card => card.id === '3001')
  assert.match(catCard.icon, /jingling\/3001\/icon.png$/)
  assert.equal(catCard.height, '0.23–0.31m')
  assert.equal(catCard.weight, '1.267–1.84kg')
  assert.equal(catCard.score, 100)
  const sizePages = renderEggPages(size)
  const allSvg = sizePages.map(page => page.svg).join('')
  for (const card of size.sections.flatMap(section => section.cards)) assert.ok(allSvg.includes(`#${card.id}`), `分页丢失候选 ${card.name}`)
  assert.ok(sizePages.every(page => (page.svg.match(/<image /g) || []).length <= 20))
  assert.match(allSvg, /你输入的蛋身高/)
  assert.match(allSvg, /100%/)
  assert.match(renderEggPages(name)[0].svg, /jingling\/3001\/icon.png/)
  assert.match(eggResultText(queryLocalEgg({ height: 0.22, weight: 1.5 })), /喵喵 #3001 · 匹配度 85.51%/)
  // 隔离边界样本，避免低分候选被前20条展示限制截断。
  eggRows.push([999999, '边界样本', 'boundary', '草', [6], 100000, 120000, 1000000, 2000000, 3600])
  try {
    assert.match(eggResultText(queryLocalEgg({ height: 850, weight: 1500 })), /边界样本 #999999 · 匹配度 50%/)
    assert.doesNotMatch(eggResultText(queryLocalEgg({ height: 849, weight: 1500 })), /边界样本/)
  } finally {
    eggRows.pop()
  }
  // 体型判定：小不点/大块头要求身高与体重同时进入各自区间的上下 2%。
  // 火花 身高 0.23–0.29m / 体重 2.66–3.4kg → 身高 0.2312m、体重 2.6748kg 为下限门槛。
  assert.match(eggResultText(queryLocalEgg({ height: 0.23, weight: 1.27 })), /喵喵 #3001[^\n]*小不点/)
  assert.match(eggResultText(queryLocalEgg({ weight: 1.27 })), /喵喵 #3001[^\n]*小不点（仅按体重）/)
  assert.match(eggResultText(queryLocalEgg({ height: 9999, weight: 9999 })), /未找到/)
  const sparkText = eggResultText(queryLocalEgg({ name: '火花' }))
  assert.match(sparkText, /蛋体重：2\.66–3\.4kg/)
  assert.match(sparkText, /体型判定（身高、体重都要进各自区间 2%）/)
  assert.match(sparkText, /小不点 身高 ≤0\.231m 且 体重 ≤2\.674kg ｜ 大块头 身高 ≥0\.289m 且 体重 ≥3\.386kg/)
  const sparkSvg = renderEggPages(queryLocalEgg({ name: '火花' }))[0].svg
  assert.match(sparkSvg, /身高 ≤0\.231m 且 体重 ≤2\.674kg/)
  assert.match(sparkSvg, /身高 ≥0\.289m 且 体重 ≥3\.386kg/)
  // 进化形态没有自己的孵化数据，判定区间回落到家族最低阶形态。
  assert.match(eggResultText(queryLocalEgg({ name: '罗隐' })), /体型判定（身高、体重都要进各自区间 2% · 最低阶 阿米亚特 #3014）/)
  assert.match(eggResultText(queryLocalEgg({ name: '罗隐' })), /大块头 身高 ≥0\.329m 且 体重 ≥19\.556kg/)
  const classify = (height, weight) => queryLocalEgg({ height, weight }).sections.flatMap(section => section.cards).find(card => card.name === '火花')
  // 只有身高或只有体重到边缘时都不是极限体型，必须两者同时达标（与洛克工具箱 height_edge_hint 一致）。
  assert.equal(classify(0.29, 3.39).sizeClass, '大块头')
  assert.equal(classify(0.23, 2.67).sizeClass, '小不点')
  assert.equal(classify(0.25, 3.39).sizeClass, '')
  assert.equal(classify(0.29, 3.0).sizeClass, '')
  assert.equal(classify(0.29, 3.38).sizeClass, '')
  assert.equal(classify(0.23, 2.68).sizeClass, '')
  assert.deepEqual(classify(0.29, 3.39).sizeClassNotes, [
    '体型判定（身高、体重都要进各自区间 2%）',
    '小不点 身高 ≤0.231m 且 体重 ≤2.674kg ｜ 大块头 身高 ≥0.289m 且 体重 ≥3.386kg',
  ])
  assert.match(renderEggPages(queryLocalEgg({ height: 0.29, weight: 3.39 })).map(page => page.svg).join(''), /大块头/)

  // 工具箱与文章交叉验证：罗隐 13.475–19.68kg 的门槛应算出文章里的 >19.556（真实门槛 19.5559）。
  const luoyinNotes = sizeClassNotes({ weightLow: 13.475, weightHigh: 19.68 })
  assert.match(luoyinNotes[1], /小不点 体重 ≤13\.599kg ｜ 大块头 体重 ≥19\.556kg/)
  const luoyinRange = { weightLow: 13.475, weightHigh: 19.68 }
  assert.equal(sizeClassLabel({ weight: 19.556 }, luoyinRange), '大块头（仅按体重）')
  assert.equal(sizeClassLabel({ weight: 19.555 }, luoyinRange), '')
  assert.equal(sizeClassLabel({ weight: 13.599 }, luoyinRange), '小不点（仅按体重）')
  assert.equal(sizeClassLabel({ weight: 13.6 }, luoyinRange), '')
  assert.deepEqual(petEggSizeRange(3003), { heightLow: 0.23, heightHigh: 0.29, weightLow: 2.66, weightHigh: 3.4 })
  assert.equal(petEggSizeRange(999999), undefined)
  // BWIKI 源不给尺寸区间，用内置快照推算体型：身高 0.29m + 体重 3.39kg 才是火花的大块头。
  const bwikiClass = parseBwikiEggResult(bwikiFixture, { height: 0.29, weight: 3.39 })
  const bwikiSpark = bwikiClass.sections[0].cards.find(card => card.name === '火花')
  assert.equal(bwikiSpark.sizeClass, '大块头')
  assert.deepEqual(bwikiSpark.sizeClassNotes, [
    '体型判定（身高、体重都要进各自区间 2%）',
    '小不点 身高 ≤0.231m 且 体重 ≤2.674kg ｜ 大块头 身高 ≥0.289m 且 体重 ≥3.386kg',
  ])
  assert.match(renderEggPages(bwikiClass).map(page => page.svg).join(''), /大块头/)
  // 只有体重到边缘、身高在中间时不算大块头。
  assert.equal(parseBwikiEggResult(bwikiFixture, { height: 0.25, weight: 3.39 }).sections[0].cards.find(card => card.name === '火花').sizeClass, '')
  assert.equal(parseBwikiEggResult(bwikiFixture, { height: 0.29, weight: 3.38 }).sections[0].cards.find(card => card.name === '火花').sizeClass, '')

  const config = { rocomApiKey: 'test-only', rocomApiBaseUrl: 'https://example.invalid', requestTimeout: 100 }
  const logger = { warn() {} }
  let primaryCalls = 0
  const primary = await queryEgg({ http: { async get(url, options) {
    primaryCalls++
    const request = new URL(url)
    assert.equal(request.hostname, 'roco.gptvip.chat')
    assert.equal(request.searchParams.get('height_m'), '0.27')
    assert.equal(request.searchParams.get('weight_kg'), '3.151')
    assert.equal(request.searchParams.has('random_egg_item_id'), false)
    assert.equal(options.headers, undefined)
    return bwikiFixture
  } } }, { ...config, rocomApiKey: '' }, logger, { height: 0.27, weight: 3.151 })
  assert.equal(primaryCalls, 1)
  const primaryCards = primary.sections[0].cards
  for (const expected of ['火花', '板板壳', '电咩咩', '海盔虫', '呼呼猪', '灵狐', '小甲虫', '厉毒小萝', '猴麦仔', '小鼓象', '牵线木偶', '霹雳宝宝', '苞米仔']) {
    assert.ok(primaryCards.some(card => card.name.replace(/（.*）$/, '') === expected), `BWIKI候选缺少 ${expected}`)
  }
  assert.equal(primaryCards.length, 13)
  assert.ok(!primaryCards.some(card => /诅咒狼灵|钨丝贝贝/.test(card.name)))
  assert.equal(primary.source, 'BWIKI 工具站')
  const lightning = primaryCards.find(card => card.name === '霹雳宝宝')
  assert.equal(lightning.score, 11.86)
  assert.equal(lightning.fitScore, 90.2)
  const primarySvg = renderEggPages(primary).map(page => page.svg).join('')
  assert.match(primarySvg, /参考概率/)
  assert.doesNotMatch(primarySvg, /尺寸匹配度/)
  assert.doesNotMatch(primarySvg, /置信度/)
  assert.doesNotMatch(primarySvg, /蛋身高 · m/)
  assert.throws(() => parseBwikiEggResult({ ok: false, matched: [] }, { height: 0.27, weight: 3.151 }))
  assert.throws(() => parseBwikiEggResult({ ok: true, matched: [{}] }, { height: 0.27, weight: 3.151 }))
  let primaryEmptyCalls = 0
  const primaryEmpty = await queryEgg({ http: { async get() { primaryEmptyCalls++; return { ok: true, matched: [] } } } }, config, logger, { height: 0.27, weight: 3.151 })
  assert.equal(primaryEmptyCalls, 1)
  assert.equal(primaryEmpty.sections[0].cards.length, 0)
  const calls = []
  const ctx = { http: { async get(url) {
    calls.push(new URL(url))
    if (url.includes('roco.gptvip.chat')) throw new Error('模拟BWIKI失败')
    if (url.includes('/egg/search')) throw new Error('模拟接口失败')
    return { code: 0, data: { items: [{ pet: { name: '测试精灵', id: 1 }, egg_size: { height: { min_m: 0.1, max_m: 0.3 }, weight: { min_kg: 1, max_kg: 2 } }, match: { layer: 'strict', percent: 75 } }] } }
  } } }
  const api = await queryEgg(ctx, config, logger, { height: 0.18, weight: 1.5 })
  assert.match(eggResultText(api), /测试精灵.*完美匹配.*75%/)
  assert.match(api.sections[0].cards[0].icon, /jingling\/3001\/icon.png$/)
  assert.equal(api.sections[0].cards[0].score, 75)
  assert.equal(calls.length, 3)
  assert.equal(calls[1].searchParams.get('height'), '0.18')
  assert.equal(calls[2].searchParams.get('pool'), 'magic')
  assert.match(api.notice, /主源暂不可用/)

  let emptyCalls = 0
  const empty = await queryEgg({ http: { async get() { emptyCalls++; return { data: { items: [] } } } } }, config, logger, { height: 0.27, weight: 1.5 })
  assert.equal(emptyCalls, 2)
  assert.match(eggResultText(empty), /未找到/)
  assert.doesNotMatch(eggResultText(empty), /喵喵/)
  const offline = await queryEgg({ http: { async get() { throw new Error('模拟离线') } } }, config, logger, { height: 0.27, weight: 1.5 })
  assert.match(eggResultText(offline), /喵喵/)
  assert.match(offline.notice, /备用数据可能不完整/)
  const malformed = await queryEgg({ http: { async get() { return { data: {} } } } }, config, logger, { name: '喵喵' })
  assert.match(eggResultText(malformed), /喵喵/)
  // 接口名称查询同样折叠同家族进化形态。
  const apiName = await queryEgg({ http: { async get(url) {
    if (url.includes('/egg/pet-groups')) return { code: 0, data: { items: [{ id: 3014, name: '阿米亚特', egg_groups: [{ group_id: 2, official_name: '怪兽' }] }] } }
    return { code: 0, data: { items: [{ id: 3015, name: '阿米樱' }, { id: 3016, name: '罗隐' }, { id: 3003, name: '火花' }, { id: 3299, name: '蹦蹦种子' }] } }
  } } }, config, logger, { name: '阿米亚特' })
  assert.deepEqual(apiName.sections[0].cards.map(card => card.name), ['火花', '蹦蹦种子'])
  assert.match(eggResultText(apiName), /已折叠同家族进化形态/)
  assert.equal(apiName.sections[0].cards.find(card => card.name === '火花').height, '0.23–0.29m')
  const apiEvolved = await queryEgg({ http: { async get(url) {
    if (url.includes('/egg/pet-groups')) return { code: 0, data: { items: [{ id: 3016, name: '罗隐', egg_groups: [{ group_id: 2, official_name: '怪兽' }] }] } }
    return { code: 0, data: { items: [{ id: 3014, name: '阿米亚特' }, { id: 3015, name: '阿米樱' }] } }
  } } }, config, logger, { name: '罗隐' })
  assert.equal(apiEvolved.pet.familyBase, '阿米亚特 #3014')
  assert.deepEqual(apiEvolved.sections[0].cards.map(card => card.name), ['阿米亚特'])
  // 接口的 height_range_m/weight_range_kg 是精灵体型范围，不能当作蛋尺寸展示。
  const apiBodyRange = await queryEgg({ http: { async get(url) {
    if (url.includes('/egg/pet-groups')) return { code: 0, data: { items: [{ id: 3003, name: '火花', egg_groups: [{ group_id: 2, official_name: '怪兽' }], height_range_m: [0.17, 0.53], weight_range_kg: [7.6, 8.5] }] } }
    return { code: 0, data: { items: [] } }
  } } }, config, logger, { name: '火花' })
  assert.equal(apiBodyRange.pet.height, '0.23–0.29m')
  assert.equal(apiBodyRange.pet.weight, '2.66–3.4kg')
  assert.equal(apiBodyRange.pet.hatch, '12小时')
  assert.match(eggResultText(apiBodyRange), /蛋身高：0\.23–0\.29m/)
  assert.match(eggResultText(apiBodyRange), /蛋体重：2\.66–3\.4kg/)
  assert.doesNotMatch(eggResultText(apiBodyRange), /0\.17|0\.53|7\.6|8\.5/)
  assert.match(eggResultText(apiBodyRange), /蛋尺寸来自内置快照/)
  assert.match(apiBodyRange.source, /内置快照/)
  // 接口明确返回 egg_size 时以接口为准，并去掉内置快照的标注。
  const apiEggSize = await queryEgg({ http: { async get(url) {
    if (url.includes('/egg/pet-groups')) return { code: 0, data: { items: [{ id: 3003, name: '火花', egg_groups: [{ group_id: 2 }], egg_size: { height: { min_m: 0.5, max_m: 0.6 }, weight: { min_kg: 5, max_kg: 6 } } }] } }
    return { code: 0, data: { items: [] } }
  } } }, config, logger, { name: '火花' })
  assert.equal(apiEggSize.pet.height, '0.5–0.6m')
  assert.equal(apiEggSize.pet.weight, '5–6kg')
  assert.equal(apiEggSize.source, '洛克魔法书')
  const localOnly = await queryEgg({ http: { get() { throw new Error('单尺寸不得请求接口') } } }, config, logger, { weight: 1.5 })
  assert.match(eggResultText(localOnly), /本地快照/)

  const pages = renderEggPages({ title: '<查蛋>', lines: Array.from({ length: 70 }, () => '<精灵>&'.repeat(30)) })
  assert.ok(pages.length > 2)
  assert.ok(pages.every(page => page.height <= 1164 && !page.svg.includes('<精灵>')))
  assert.match(pages[0].svg, /&lt;精灵&gt;&amp;/)

  // 使用 Koishi 的真实声明解析，确认可变参数实际按两个字符串传入。
  const app = new Context()
  const command = app.command('查蛋 [...args:string]')
  const argv = command.parse('0.18 1.5')
  assert.deepEqual(argv.args, ['0.18', '1.5'])
  console.log('查蛋测试通过：参数、单位、本地数据、匹配度、小不点大块头判定、接口回退、成功空集、图标回退与编号、分页无丢失、转义、家族最低阶折叠、素材失败占位、Koishi参数解析')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
