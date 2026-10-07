import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PreviewFile } from '../types'
import { openFile, revealFile } from './os'
import { droppedImagePath, tokens } from './paths'

const draft = atom({ plugin: 'image-preview', key: 'draft' } as const, '')
const files = atom({ plugin: 'image-preview', key: 'files' } as const, {} as Record<string, PreviewFile>)
const origins = atom({ plugin: 'image-preview', key: 'origins' } as const, {} as Record<string, string>)
// Images the user cleared from the pane, so a rescan doesn't bring them back.
const cleared = atom({ plugin: 'image-preview', key: 'cleared' } as const, {} as Record<string, boolean>)

// Dropped or pasted file paths not yet matched to an [Image #N] chip.
let pending: string[] = []

// Icon labels of one width, so the buttons match.
const PAD = (icon: string) => `  ${icon}  `

async function scan($: any) {
  const sid = await $.session.id()
  const r = await $.process.run(['find', '/private/tmp', '/tmp', '-maxdepth', '5', '-path', `*/${sid}/images/*`])
  const gone = await read($, cleared)
  const found: Record<string, PreviewFile> = {}
  for (const line of r.stdout.split('\n')) {
    const m = /\/images\/(\d+)\.[A-Za-z]+$/.exec(line.trim())
    if (m && !gone[m[1]]) found[m[1]] = { path: line.trim() }
  }
  await update($, files, cur => ({ ...cur, ...found }))
}

async function locate($: any, n: number) {
  const sid = await $.session.id()
  const r = await $.process.run(['find', '/private/tmp', '/tmp', '-maxdepth', '5', '-path', `*/${sid}/images/${n}.*`])
  const path = r.stdout.split('\n').find((l: string) => l.trim())
  if (path) {
    await update($, files, m => ({ ...m, [n]: { path } }))
  }
}

const PANE = 'image-preview'

async function clearAll($: any) {
  const ids = Object.keys(await read($, files))
  await update($, cleared, m => ({ ...m, ...Object.fromEntries(ids.map(id => [id, true])) }))
  await update($, files, () => ({}))
}

async function toggle($: any) {
  const isUp = (await $.ui.panes()).some((p: any) => p.id === PANE)
  if (isUp) {
    await $.ui.close({ id: PANE })
    return
  }
  await scan($)
  await $.ui.open({ id: PANE, title: 'Images', focus: true })
}

async function show($: any, n: number) {
  const run = (argv: string[]) => $.process.run(argv)
  const origin = (await read($, origins))[n]
  // The dropped file may have been moved since, so the saved copy is the fallback.
  if (origin && (await openFile(run, origin))) return true
  let have = (await read($, files))[n]
  if (!have) {
    await locate($, n)
    have = (await read($, files))[n]
  }
  if (have && (await openFile(run, have.path))) return true
  await $.ui.toast(`Image #${n} isn't saved yet or can't be found`)
  return false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'image-preview',
      description: 'Preview a pasted image in a pane: /image-preview [n]',
    })
    return next(e)
  })

  on('command.run', { command: 'image-preview' }, async ($, e: any) => {
    const arg = Number(String(e.args ?? '').trim())
    await scan($)
    if (!arg) {
      await $.ui.open({ id: PANE, title: 'Images', focus: true })
      return { text: 'Images pane opened.' }
    }
    const n = arg
    const ok = await show($, n)
    return { text: ok ? `Opened Image #${n}.` : `Image #${n} not found.` }
  })

  on('prompt.edit', async ($, e, next) => {
    const result: any = await next(e)
    const after: string =
      result?.text ?? e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    await update($, draft, () => after)
    if (after.trim() === '') pending = []
    const dropped = droppedImagePath(e.inputText)
    if (dropped) pending.push(dropped)
    const before = new Set(tokens(e.text))
    for (const n of tokens(after)) {
      if (before.has(n)) continue
      const origin = pending.shift()
      if (origin) await update($, origins, m => ({ ...m, [n]: origin }))
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, draft, () => '')
    pending = []
    const sent = await next(e)
    await scan($).catch(() => {})
    return sent
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e)
    const text = await read($, draft)
    const ns = [...new Set(tokens(text))]
    return (
      <Box flexDirection="row" gap={1}>
        <Button key="toggle-pane" plain onPress={() => toggle($)}>
          {'📷 Images'}
        </Button>
        {ns.map(n => (
          <Button
            key={`img-${n}`}
            plain
            onPress={() => show($, n)}
          >
            {`🖼  Image #${n}`}
          </Button>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const known = await read($, files)
    const origin = await read($, origins)
    const shown = (n: number) => origin[n] ?? known[n].path
    const ids = Object.keys(known).map(Number).sort((a, b) => a - b)
    // Tooltips are the last children of the root, so nothing paints over them:
    // an absolute Box paints over siblings before it only. Each joins its
    // button's hover scope, and sits at a position the fixed layout gives.
    const ROW0 = 4
    const ROWH = 3
    const COLS = [2, 14, 26]
    const tip = (key: string, top: number, left: number, text: string) => (
      <Box
        key={`card-${key}`}
        position="absolute"
        top={top}
        left={left}
        display="none"
        hover={{ display: 'flex', scope: key }}
        borderStyle="round"
        backgroundColor="inverseText"
        paddingX={1}
      >
        <Text color="text">{text}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column" paddingX={1} paddingBottom={4}>
        <Box
          key="clear-box"
          hover={{ scope: 'tip-clear' }}
          alignSelf="flex-start"
        >
          <Button key="clear" onPress={() => clearAll($)}>
            {PAD('🧹')}
          </Button>
        </Box>
        <Text> </Text>
        <Text bold>Images in this session</Text>
        <Text> </Text>
        {ids.length === 0 && <Text dimColor>No images yet.</Text>}
        {ids.map(n => (
          <Box
            key={`row-${n}`}
            flexDirection="row"
            alignItems="center"
            gap={2}
            paddingX={1}
            paddingY={1}
            hover={{ backgroundColor: 'subtle' }}
          >
            <Box
              key={`reveal-box-${n}`}
              hover={{ scope: `tip-reveal-${n}` }}
            >
              <Button
                key={`reveal-${n}`}
                onPress={() => revealFile((argv: string[]) => $.process.run(argv), shown(n))}
              >
                {PAD('📂')}
              </Button>
            </Box>
            <Box
              key={`copy-box-${n}`}
              hover={{ scope: `tip-copy-${n}` }}
            >
              <Button
                key={`copy-${n}`}
                onPress={(press: any) =>
                  $.ui.copy({ text: shown(n), surface: press.surface })
                }
              >
                {PAD('📋')}
              </Button>
            </Box>
            <Box
              key={`view-box-${n}`}
              hover={{ scope: `tip-view-${n}` }}
            >
              <Button key={`view-${n}`} onPress={() => show($, n)}>
                {PAD('👀')}
              </Button>
            </Box>
            <Button key={`open-${n}`} plain onPress={() => show($, n)}>
              {`[Image #${n}]`}
            </Button>
          </Box>
        ))}
        {tip('tip-clear', 1, 1, 'Clear list')}
        {ids.map((n, i) => {
          const rowTop = ROW0 + i * ROWH
          // Below the row, unless the card would run past the bottom edge of the
          // window as scrolled: then above the button (the card is 3 rows tall,
          // the button on the row's middle line).
          const offset = e.props?.scroll?.offset ?? 0
          const room = e.props?.scroll?.bodyRows ?? e.viewport?.rows ?? 24
          const below =
            rowTop + ROWH + 3 - offset > room ? rowTop - 2 : rowTop + ROWH
          return [
            tip(`tip-reveal-${n}`, below, COLS[0], 'Show in Finder'),
            tip(`tip-copy-${n}`, below, COLS[1], 'Copy path'),
            tip(`tip-view-${n}`, below, COLS[2], 'View in OS preview'),
          ]
        })}
      </Box>
    )
  })
}
