require('esbuild-register')
const assert = require('node:assert/strict')
const { parseEggQuery, queryLocalEgg, queryEgg } = require('../src/services/egg-query.ts')
const { renderEggPages, eggResultText } = require('../src/render/egg.ts')
const { Context } = require('koishi')
const { eggRows } = require('../src/data/egg-data.ts')

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
  assert.ok(sizePages.every(page => (page.svg.match(/<image /g) || []).length <= 8))
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
  assert.match(eggResultText(queryLocalEgg({ height: 0.27, weight: 1.27 })), /喵喵 #3001[^\n]*小块头/)
  assert.match(eggResultText(queryLocalEgg({ height: 9999, weight: 9999 })), /未找到/)

  const config = { rocomApiKey: 'test-only', rocomApiBaseUrl: 'https://example.invalid', requestTimeout: 100 }
  const logger = { warn() {} }
  const calls = []
  const ctx = { http: { async get(url) {
    calls.push(new URL(url))
    if (url.includes('/egg/search')) throw new Error('模拟接口失败')
    return { code: 0, data: { items: [{ pet: { name: '测试精灵', id: 1 }, egg_size: { height: { min_m: 0.1, max_m: 0.3 }, weight: { min_kg: 1, max_kg: 2 } }, match: { layer: 'strict', percent: 75 } }] } }
  } } }
  const api = await queryEgg(ctx, config, logger, { height: 0.18, weight: 1.5 })
  assert.match(eggResultText(api), /测试精灵.*完美匹配.*75%/)
  assert.match(api.sections[0].cards[0].icon, /jingling\/3001\/icon.png$/)
  assert.equal(api.sections[0].cards[0].score, 75)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].searchParams.get('height'), '0.18')
  assert.equal(calls[1].searchParams.get('pool'), 'magic')

  let emptyCalls = 0
  const empty = await queryEgg({ http: { async get() { emptyCalls++; return { data: { items: [] } } } } }, config, logger, { height: 0.27, weight: 1.5 })
  assert.equal(emptyCalls, 1)
  assert.match(eggResultText(empty), /未找到/)
  assert.doesNotMatch(eggResultText(empty), /喵喵/)
  const offline = await queryEgg({ http: { async get() { throw new Error('模拟离线') } } }, config, logger, { height: 0.27, weight: 1.5 })
  assert.match(eggResultText(offline), /喵喵/)
  const malformed = await queryEgg({ http: { async get() { return { data: {} } } } }, config, logger, { name: '喵喵' })
  assert.match(eggResultText(malformed), /喵喵/)
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
  console.log('查蛋测试通过：参数、单位、本地数据、匹配度、大小块头、接口回退、成功空集、图标与数字、分页无丢失、转义、Koishi参数解析')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
