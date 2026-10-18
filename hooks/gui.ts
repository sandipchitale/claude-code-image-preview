// The browser window: a small local server (server/server.mjs) lives as long as this module, a Chrome
// app window shows its page, and a heartbeat keeps it up. Without the server the mod uses its pane.
const HEARTBEAT_MS = 15_000

let port: number | undefined
let token = ''
let isStarting = false
let hasHeartbeat = false

export type Payload = { session: string; origins: Record<string, string>; select?: number }

export const isUp = () => port !== undefined

async function post($: any, path: string, body: unknown = {}) {
  if (port === undefined) return undefined
  try {
    return await $.http.fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'x-preview-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return undefined
  }
}

// The child lives as long as this loop: it ends with the module or the server.
function startServer($: any, onReady: () => void, onFail: () => void) {
  if (isStarting || port !== undefined) return
  isStarting = true
  void (async () => {
    let buffer = ''
    try {
      const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/server/server.mjs`] })
      for await (const piece of child) {
        if (!('stream' in piece) || piece.stream !== 'stdout' || port !== undefined) continue
        buffer += piece.text
        const newline = buffer.indexOf('\n')
        if (newline < 0) continue
        const hello = JSON.parse(buffer.slice(0, newline))
        token = hello.token
        port = hello.port
        if (!hasHeartbeat) {
          hasHeartbeat = true
          $.clock.every(HEARTBEAT_MS, () => void post($, '/ping'))
        }
        onReady()
      }
    } catch (error) {
      $.ui.log(`image-preview: server failed: ${String(error)}`, { to: 'debug' })
    } finally {
      const failed = port === undefined
      port = undefined
      token = ''
      isStarting = false
      if (failed) onFail()
    }
  })()
}

// Opens the window, starting the server first if it is not running. `onFail` runs when it cannot start.
export async function openGui($: any, payload: Payload, onFail: () => void) {
  if (port === undefined) {
    startServer($, () => void post($, '/open-window', payload), onFail)
    return 'starting'
  }
  const res = await post($, '/open-window', payload)
  if (!res?.ok) return 'unanswered'
  let reused = false
  try {
    reused = JSON.parse(res.text).reused === true
  } catch {}
  return reused ? 'reused' : 'opened'
}

// Tell a running server about a newly learned dropped-file path. Fire and forget.
export function sync($: any, payload: Payload) {
  if (port !== undefined) void post($, '/sync', payload)
}
