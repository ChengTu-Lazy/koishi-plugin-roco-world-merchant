// 由上游 Pets.json 的 evolves_from_id 生成 src/data/egg-families.ts（精灵家族 → 最低阶映射）。
// 用法：node scripts/build-egg-families.cjs [Pets.json 路径]
// 省略路径时从 THIRD-PARTY-NOTICES.md 记录的上游提交下载。
require('esbuild-register')

const fs = require('node:fs')
const path = require('node:path')

const { eggRows } = require('../src/data/egg-data.ts')

const UPSTREAM_COMMIT = '845ea74887b2088428ed1be118a8b62f1d2905e5'
const UPSTREAM_URL = `https://raw.githubusercontent.com/Entropy-Increase-Team/koishi-plugin-rocom/${UPSTREAM_COMMIT}/src/render-templates/searcheggs/Pets.json`
const OUTPUT = path.join(__dirname, '..', 'src', 'data', 'egg-families.ts')

async function loadPets(input) {
  if (input) return JSON.parse(fs.readFileSync(input, 'utf8'))
  const response = await fetch(UPSTREAM_URL)
  if (!response.ok) throw new Error(`下载上游 Pets.json 失败：HTTP ${response.status}`)
  return response.json()
}

function buildRootLookup(byId) {
  // 沿 evolves_from_id 回溯到没有进化前身的精灵；上游存在变体互相进化的环，取环上最小 ID 保证结果稳定。
  return id => {
    const path = []
    const seen = new Map()
    let current = id
    while (current != null) {
      if (seen.has(current)) return Math.min(...path.slice(seen.get(current)))
      const pet = byId.get(current)
      if (!pet || pet.evolves_from_id == null) return current
      seen.set(current, path.length)
      path.push(current)
      current = pet.evolves_from_id
    }
    return id
  }
}

function render(entries) {
  const lines = []
  for (let index = 0; index < entries.length; index += 10) {
    lines.push('  ' + entries.slice(index, index + 10).map(([id, root]) => `${id}: ${root},`).join(' '))
  }
  return `// 查蛋精灵家族（进化链）数据摘录，来源与许可见 THIRD-PARTY-NOTICES.md。
// 上游文件：src/render-templates/searcheggs/Pets.json
// 上游提交：${UPSTREAM_COMMIT}
// 由 scripts/build-egg-families.cjs 生成，请勿手工修改。
// 键为精灵 ID，值为同家族最低阶精灵 ID；仅收录存在进化前身的精灵。
export const eggFamilyRoots: Record<number, number> = {
${lines.join('\n')}
}
`
}

async function main() {
  const input = process.argv[2]
  const pets = await loadPets(input)
  const byId = new Map(pets.map(pet => [pet.id, pet]))
  const rootOf = buildRootLookup(byId)
  const rowIds = new Set(eggRows.map(row => row[0]))
  const entries = eggRows
    .filter(row => {
      const pet = byId.get(row[0])
      return pet && pet.evolves_from_id != null
    })
    .map(row => [row[0], rootOf(row[0])])
    // 环上的最低阶精灵自身不再收录，否则会被误判成进化形态。
    .filter(([id, root]) => id !== root)
  const skipped = entries.filter(([, root]) => !rowIds.has(root))
  if (skipped.length) console.warn(`警告：${skipped.length} 只精灵的最低价形态不在内置数据中，已跳过：${skipped.map(([id]) => id).join(', ')}`)
  const output = entries.filter(([, root]) => rowIds.has(root)).sort((a, b) => a[0] - b[0])
  fs.writeFileSync(OUTPUT, render(output), 'utf8')
  console.log(`已写入 ${path.relative(path.join(__dirname, '..'), OUTPUT)}：${output.length} 条家族映射（内置精灵 ${eggRows.length} 只）`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
