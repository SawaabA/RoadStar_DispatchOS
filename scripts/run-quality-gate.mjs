import { spawnSync } from 'node:child_process'

// Deterministic release checks, in increasing order of cost.
const checks = [
  ['Unit and domain tests', 'npm', ['test']],
  ['Production type-check and bundle', 'npm', ['run', 'build']],
  ['Web gateway syntax', 'node', ['--check', 'services/web-server/server.mjs']],
  ['Integration gateway syntax', 'node', ['--check', 'services/integration-gateway/server.mjs']],
  ['xflp sidecar compilation', 'node', ['services/loading-solver/build.mjs']],
  ['Browser journeys and accessibility', 'npm', ['run', 'test:e2e']],
  ['Working tree whitespace', 'git', ['diff', '--check']],
]

for (const [name, command, args] of checks) {
  console.log(`\n[QUALITY] ${name}`)
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) {
    console.error(`[QUALITY] ${name} could not start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[QUALITY] ${name} failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\n[QUALITY] All deterministic release checks passed.')
