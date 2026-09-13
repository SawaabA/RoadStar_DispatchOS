import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { extname, join } from 'node:path'

// Serves the built bundle through the production web gateway and checks that
// every script and stylesheet has a type browsers will execute. The gateway
// sends nosniff, so a module worker served as application/octet-stream is
// refused in production while working under the Vite dev server that the
// browser journeys use.

const expected = { '.js': /^text\/javascript/, '.mjs': /^text\/javascript/, '.css': /^text\/css/ }
const assetsDir = join('dist', 'assets')
const assets = readdirSync(assetsDir).filter((name) => Object.hasOwn(expected, extname(name)))
if (!assets.length) {
  console.error(`[ASSETS] No scripts or stylesheets found in ${assetsDir}; run the build first.`)
  process.exit(1)
}

const port = await new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address()
    probe.close(() => resolve(free))
  })
})
const server = spawn(process.execPath, ['services/web-server/server.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
const base = `http://127.0.0.1:${port}`

let failures = 0
try {
  const deadline = Date.now() + 10_000
  for (;;) {
    try { if ((await fetch(`${base}/healthz`)).ok) break } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error('web gateway did not start')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  for (const name of assets) {
    const response = await fetch(`${base}/assets/${encodeURIComponent(name)}`)
    const type = response.headers.get('content-type') ?? ''
    await response.arrayBuffer()
    if (!response.ok || !expected[extname(name)].test(type)) {
      failures += 1
      console.error(`[ASSETS] ${name}: HTTP ${response.status}, Content-Type "${type}"`)
    }
  }
} finally {
  server.kill('SIGTERM')
}

if (failures) process.exit(1)
console.log(`[ASSETS] ${assets.length} scripts and stylesheets are served with executable types.`)
