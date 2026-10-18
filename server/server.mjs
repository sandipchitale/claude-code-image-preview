// Image preview server. Zero dependencies. Prints {"port":N,"token":"…"} on stdout once listening.
// Lives and dies with the mod: exits when it hears no heartbeat (POST /ping) for IDLE_MS.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as lib from './images-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.IMAGE_PREVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const IDLE_MS = Number(process.env.IMAGE_PREVIEW_IDLE_MS ?? 60_000)
const TOKEN = crypto.randomUUID()

let lastSeen = Date.now()
let chrome = null
let port = 0
let session = ''
let origins = {}
// The page polls; one that polled lately is an open window. A chip click asks it to show an image.
let lastPoll = 0
let want = { n: 0, id: 0 }
const WINDOW_LIVE_MS = 5000

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const body = req =>
  new Promise(resolve => {
    let s = ''
    req.on('data', c => s.length < 100_000 && (s += c))
    req.on('end', () => resolve(s))
  })

// argv only, never a shell. Resolves true when the command worked.
function attempt({ argv, trustExit }) {
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0 || trustExit === true))
  })
}

async function firstOk(attempts) {
  for (const a of attempts) if (await attempt(a)) return true
  return false
}

const list = () => lib.buildList(session, origins)

function openWindow(select) {
  const url = `http://127.0.0.1:${port}/${select ? `?select=${encodeURIComponent(select)}` : ''}`
  // Chrome in its own profile, as an app window (no tabs). Without Chrome, use the default browser.
  if (!fs.existsSync(CHROME)) return firstOk(lib.openAttempts(url))
  const child = spawn(
    CHROME,
    [
      `--app=${url}`,
      `--user-data-dir=${process.env.IMAGE_PREVIEW_PROFILE ?? path.join(os.tmpdir(), 'claude-image-preview-profile')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,820',
      ...(process.env.IMAGE_PREVIEW_CHROME_ARGS?.split(' ').filter(Boolean) ?? []),
    ],
    { stdio: 'ignore' },
  )
  child.on('error', () => {})
  if (!chrome || chrome.exitCode !== null) chrome = child
  return Promise.resolve(true)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  // Refuse DNS rebinding: only our own origin may talk to us.
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.writeHead(421)
    return res.end()
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    return res.end(fs.readFileSync(path.join(here, 'public', 'index.html'), 'utf8').replace('__TOKEN__', TOKEN))
  }
  // Everything below needs the token: the images are the user's own, and may be private.
  const token = req.headers['x-preview-token'] ?? url.searchParams.get('t')
  if (token !== TOKEN) {
    res.writeHead(403)
    return res.end()
  }
  if (req.method === 'GET' && url.pathname === '/api/images') {
    lastPoll = Date.now()
    return json(res, 200, { platform: process.platform, images: list(), want })
  }
  const image = /^\/api\/image\/(\d+)$/.exec(url.pathname)
  if (req.method === 'GET' && image) {
    // Only a file the list names is served, never a path from the page.
    const row = list().find(r => r.n === Number(image[1]))
    if (!row) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': row.mime, 'content-length': row.size, 'cache-control': 'no-store' })
    return fs.createReadStream(row.path).pipe(res)
  }
  if (req.method === 'POST') {
    lastSeen = Date.now()
    if (url.pathname === '/ping') {
      res.writeHead(204)
      return res.end()
    }
    let b = {}
    try {
      b = JSON.parse((await body(req)) || '{}')
    } catch {}
    if (url.pathname === '/open-window' || url.pathname === '/sync') {
      if (typeof b.session === 'string' && lib.SESSION_ID.test(b.session)) session = b.session
      if (b.origins && typeof b.origins === 'object') origins = b.origins
      if (url.pathname === '/sync') return json(res, 200, { ok: true })
      const select = Number(b.select)
      if (select > 0) want = { n: select, id: want.id + 1 }
      // A window that is already open just switches to the image; a second one is not opened.
      if (Date.now() - lastPoll < WINDOW_LIVE_MS) return json(res, 200, { opened: true, reused: true })
      return json(res, 200, { opened: await openWindow(select > 0 ? select : 0) })
    }
    if (url.pathname === '/api/open' || url.pathname === '/api/reveal') {
      const row = list().find(r => r.n === Number(b.n))
      if (!row) return json(res, 404, { ok: false, error: 'not found' })
      const reveal = url.pathname === '/api/reveal'
      const ok = await firstOk(reveal ? lib.revealAttempts(row.path) : lib.openAttempts(row.path))
      return json(res, 200, { ok })
    }
  }
  res.writeHead(404)
  res.end()
})

function shutdown() {
  if (chrome && chrome.exitCode === null) chrome.kill()
  server.close()
  process.exit(0)
}

server.listen(0, '127.0.0.1', () => {
  port = server.address().port
  process.stdout.write(JSON.stringify({ port, token: TOKEN }) + '\n')
})

setInterval(() => {
  if (Date.now() - lastSeen > IDLE_MS) shutdown()
}, 5000).unref()
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('exit', () => chrome && chrome.exitCode === null && chrome.kill())
