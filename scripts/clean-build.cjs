const fs = require('node:fs')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..')
const cleanupTargets = [
  path.join(rootDir, 'lib'),
  path.join(rootDir, 'tsconfig.tsbuildinfo'),
]

for (const target of cleanupTargets) {
  fs.rmSync(target, { recursive: true, force: true })
}

console.log('已清理旧构建产物：lib, tsconfig.tsbuildinfo')
