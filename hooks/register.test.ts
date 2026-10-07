import { test, expect } from 'claude-code/testing'
import { openArgv, revealArgv } from './os'

test('token regex matches image chips', () => {
  const t = (s: string) => [...s.matchAll(/\[Image #?(\d+)\]/g)].map(m => Number(m[1]))
  expect(t('a [Image #1] b [Image 2]')).toEqual([1, 2])
})

test('open tries mac, linux, then windows', () => {
  expect(openArgv('/a/1.png').map(a => a.argv[0])).toEqual(['open', 'xdg-open', 'cmd'])
})

test('reveal falls back to explorer, then the folder on linux', () => {
  const r = revealArgv('/a/b/1.png')
  expect(r[1].argv).toEqual(['explorer', '/select,/a/b/1.png'])
  expect(r[2].argv).toEqual(['xdg-open', '/a/b'])
})
