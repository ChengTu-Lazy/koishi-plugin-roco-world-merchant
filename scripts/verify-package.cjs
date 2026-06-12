const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const pkgPath = path.resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const cwd = path.dirname(pkgPath)

const mainFile = normalizePath(pkg.main)
const typingsFile = normalizePath(pkg.typings)
const requiredFiles = [mainFile, typingsFile]

for (const file of requiredFiles) {
  const resolved = path.resolve(cwd, file)
  if (!fs.existsSync(resolved)) {
    throw new Error(`缺少构建产物：${file}`)
  }
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const output = execSync(`${npmCommand} pack --json --dry-run`, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})

const packs = JSON.parse(output)
const packedFiles = new Set((packs[0]?.files || []).map(item => normalizePath(item.path)))

for (const file of requiredFiles) {
  if (!packedFiles.has(file)) {
    throw new Error(`npm 包内缺少文件：${file}`)
  }
}

console.log(`已验证 npm 包产物：${requiredFiles.join(', ')}`)

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/')
}
