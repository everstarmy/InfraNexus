import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

// All mutable backend state belongs to this disposable directory.
const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'infranexus-smoke-'))
const binary = join(directory, 'server')
const children = []
let closing = false
async function close(code = 0) {
  if (closing) return
  closing = true
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = globalThis.setTimeout(() => child.kill('SIGKILL'), 12000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })))
  await rm(directory, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGTERM', () => void close())
process.on('SIGINT', () => void close())
function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
  children.push(child)
  child.on('error', () => void close(1))
  child.on('exit', () => { if (!closing) void close(1) })
  return child
}
try {
  execFileSync('go', ['-C', 'backend', 'build', '-o', binary, './cmd/server'], { cwd: root, stdio: 'inherit' })
  const env = { ...process.env,
    APP_APP_ENV: 'test', APP_APP_PORT: '18081', APP_APP_DEBUG: 'false',
    APP_DATABASE_DRIVER: 'sqlite', APP_DATABASE_SQLITE_DBPATH: join(directory, 'smoke.db'),
    APP_STORAGE_DRIVER: 'memory', APP_REDIS_HOST: '127.0.0.1', APP_REDIS_PORT: '1',
    APP_LDAP_SCHEDULER_ENABLED: 'false', APP_SECURITY_LOGIN_RATE_LIMIT: '100',
    APP_SECURITY_TRUSTED_ORIGINS: 'http://127.0.0.1:4175',
    APP_SECURITY_TRUSTED_PROXIES: '', APP_SESSION_SECURE: 'false', APP_SESSION_DOMAIN: '',
    APP_LOGGING_SQL_ENABLED: 'false', APP_LOGGING_OUTPUT: 'stdout',
    INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD: 'Smoke!Admin2468',
  }
  execFileSync(binary, ['bootstrap-admin'], { cwd: join(root, 'backend'), env, stdio: 'inherit' })
  delete env.INFRANEXUS_BOOTSTRAP_ADMIN_PASSWORD
  // Backend reads config.yaml from the repository, but its database is isolated above.
  const backend = spawn(binary, [], { cwd: join(root, 'backend'), env, stdio: 'inherit' })
  children.push(backend)
  backend.on('error', () => void close(1))
  backend.on('exit', () => { if (!closing) void close(1) })
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:18081/api/v1/ready')).ok) { ready = true; break } } catch {}
    await setTimeout(200)
  }
  if (!ready) throw new Error('isolated backend did not become ready')
  start(process.execPath, [join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4175', '--strictPort', join(root, 'frontend')], { ...process.env, INFRANEXUS_PROXY_TARGET: 'http://127.0.0.1:18081' })
} catch (error) {
  console.error('Smoke server setup failed:', error.message)
  await close(1)
}
