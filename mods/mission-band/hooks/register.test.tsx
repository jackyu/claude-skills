import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Missions } from '../types'
import { NO_MISSION_TEXT } from './prompt-context'

const ABOVE_PROMPT = (bodyColumns: number, maxRows = 10) =>
  ({
    hasSurvey: false,
    isWorking: false,
    maxRows,
    bodyColumns,
    scroll: { offset: 0, bodyRows: maxRows },
    view: {},
  }) as const

// 獨立於 band.ts 自己回報的列數之外，從實際畫出來的樹（含框線、標題）重算一次高度，
// 證明 model 的預算公式跟 register.tsx 畫出來的東西真的對得上，不是球員兼裁判。
// Box 全是葉節點（Text／Link，沒有巢狀 Box）時算一行；column 方向把每個直接子元素的
// 行數加總，row 方向（並排的兩個框）取最大值；borderStyle 另外加 2 行（上下框線）。
type DrawnNode = { type: string; props?: Record<string, unknown>; children?: unknown[] }

function asDrawnNode(value: unknown): DrawnNode | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) return undefined
  return value as DrawnNode
}

function visualLineCount(value: unknown): number {
  const el = asDrawnNode(value)
  if (el === undefined) return 0

  const children = (el.children ?? []).map(asDrawnNode).filter((c): c is DrawnNode => c !== undefined)
  const border = el.props?.borderStyle !== undefined ? 2 : 0
  const boxChildren = children.filter(c => c.type === 'Box')

  if (boxChildren.length === 0) {
    return children.length === 0 ? 0 : 1 + border
  }
  if (el.props?.flexDirection === 'row') {
    return border + Math.max(...boxChildren.map(visualLineCount))
  }
  const total = children.reduce((sum, c) => sum + (c.type === 'Box' ? visualLineCount(c) : 1), 0)
  return total + border
}

const PRESENTATION = { isFullscreen: false, columns: 80 } as const
const PLAYBOOK_PATH = '/Users/x/.claude/pstack/v1/skills/poteto-mode/playbooks/prototype.md'

// root 是即問即答（見 register.tsx 的 currentRoot），不在 session.start 快取；
// 這個閉包變數隨時改隨時生效，不需要重跑 $.session.start 才能切到新的 root。
//
// session.repo() 回 null，所以 setup 檢查只會驗 pstack 那一項；fs.exists 一律回 true、
// fs.read 回一段帶「## Agent skills」的內容，讓既有的 mission-start 測試不會被 setup 檢查擋下。
type TestSessionRepo = { root: string; remote: string | null; internal: boolean; name: string }

function setupRoot(on: On, repo: TestSessionRepo | null = null) {
  let root = '/repo'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: root }))
  on('session.repo', () => ({ value: repo }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))

  return (next: string) => {
    root = next
  }
}

// $.store.get 不在測試驅動用的 Engine 介面上（那個 $ 只開放 tool.call／skill.prompt 這類
// 「驅動」事件，不是任意 noun），要讀 store 內容得像這樣自己接 store.get／store.set 到一個
// Map，取代 mock.store(on)，再直接讀這個 Map，不透過 $。
function mockStoreMap(on: On): Map<string, unknown> {
  const storeMap = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: storeMap.get(e.key) }))
  on('store.set', (_, e) => {
    storeMap.set(e.key, e.value)
    return { value: undefined }
  })
  return storeMap
}

// setupRoot 本身會註冊一份預設的 tool.call（回空結果）；要客製 tool.call 回應（stdout、
// 計數呼叫次數...）的測試不能再疊一次 on('tool.call', ...)（引擎會拒絕：registered twice），
// 改用這份不含 tool.call 的版本，自己註冊剛好一次。
function setupRootNoToolCall(on: On, repo: TestSessionRepo | null = null) {
  let root = '/repo'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: root }))
  on('session.repo', () => ({ value: repo }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
  return (next: string) => {
    root = next
  }
}

test('routes a skill event to the mission bound to that root, not another', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo-a')
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  await run('mission-start', 'alpha')

  setRoot('/repo-b')
  await $.session.start({ cwd: '/repo-b', surface: null, isInteractive: false })
  await run('mission-start', 'beta')

  setRoot('/repo-a')
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'hi' })

  const here = await run('mission-log')
  expect(here.text).toContain('grill-with-docs')

  setRoot('/repo-b')
  await $.session.start({ cwd: '/repo-b', surface: null, isInteractive: false })
  const elsewhere = await run('mission-log')
  expect(elsewhere.text).toBe('還沒有事件')
})

test('an event raised where no mission is bound is not recorded', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo-a')
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  await run('mission-start', 'alpha')

  setRoot('/repo-unbound')
  await $.session.start({ cwd: '/repo-unbound', surface: null, isInteractive: false })
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'hi' })

  setRoot('/repo-a')
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  const log = await run('mission-log')
  expect(log.text).toBe('還沒有事件')
})

test('two worktrees of the same repo bind two different missions (session.repo().root is not the worktree root)', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let root = '/main-checkout'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: root }))
  // session.repo().root 永遠指向主 checkout，跟 worktree 自己的路徑不同；
  // 綁定一定要用 session.root()，用 session.repo().root 兩個 worktree 會被誤判成同一個目錄。
  on('session.repo', () => ({
    value: { root: '/main-checkout', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' },
  }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  root = '/main-checkout/.worktrees/feat-a'
  await $.session.start({ cwd: root, surface: null, isInteractive: false })
  const startA = await run('mission-start', 'alpha')
  expect(startA.text).toContain('已建立')

  root = '/main-checkout/.worktrees/feat-b'
  await $.session.start({ cwd: root, surface: null, isInteractive: false })
  const startB = await run('mission-start', 'beta')
  expect(startB.text).toContain('已建立')

  const list = await run('mission-list')
  expect(list.text).toContain('alpha')
  expect(list.text).toContain('beta')
})

test('a pstack playbook read through Read is recorded as a read event', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.tool.call({ tool: 'Read', file_path: PLAYBOOK_PATH })

  const log = await run('mission-log')
  expect(log.text).toContain('read playbook:prototype main')
})

test('the Bash hook records a pstack read for cat but not for grep', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.tool.call({ tool: 'Bash', command: `cat '${PLAYBOOK_PATH}'` })
  const afterCat = await run('mission-log')
  expect(afterCat.text).toContain('read playbook:prototype main')

  await $.tool.call({ tool: 'Bash', command: `grep foo '${PLAYBOOK_PATH}'` })
  const afterGrep = await run('mission-log')
  expect(afterGrep.text).toBe(afterCat.text)
})

test('mission-next refuses unfinished nodes, allows after skipping, and finish needs --force', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const refused = await run('mission-next')
  expect(refused.text).toContain('grill-with-docs')

  await run('mission-skip', 'grill-with-docs 用口頭確認過')
  await run('mission-skip', 'approach 用口頭確認過')
  await run('mission-skip', 'prototype 不需要設計決定')
  await run('mission-skip', 'to-spec 先用口頭 spec')
  await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
  await run('mission-skip', 'create-worktree 測試情境不需要真的建')

  const advanced = await run('mission-next')
  expect(advanced.text).toContain('實作')

  const refusedFinish = await run('mission-finish')
  expect(refusedFinish.text).toContain('--force')

  const finished = await run('mission-finish', 'demo --force')
  expect(finished.text).toContain('已清除')

  const list = await run('mission-list')
  expect(list.text).toBe('目前沒有任務')
})

test('mission-next allows the real path: grill started, prototype skipped, to-spec started', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'hi' })
  await $.skill.prompt({ skill: 'mattpocock-skills:approach', text: 'hi' })
  await run('mission-skip', 'prototype 不需要設計決定')
  await $.skill.prompt({ skill: 'mattpocock-skills:to-spec', text: 'hi' })
  await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
  await run('mission-skip', 'create-worktree 測試情境不需要真的建')

  const advanced = await run('mission-next')
  expect(advanced.text).toContain('實作')
})

test('mission-restore rebinds a mission to this root, refusing a root already bound', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo-a')
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  setRoot('/repo-c')
  await $.session.start({ cwd: '/repo-c', surface: null, isInteractive: false })
  await run('mission-start', 'other')

  const refused = await run('mission-restore', 'demo')
  expect(refused.text).toContain('other')

  setRoot('/repo-b')
  await $.session.start({ cwd: '/repo-b', surface: null, isInteractive: false })
  const restored = await run('mission-restore', 'demo')
  expect(restored.text).toContain('demo')

  const list = await run('mission-list')
  expect(list.text).toContain('← 目前')
})

test('the band draws tabs, steps and the next-step row at steps-only width, the asset box at two-box width, and squeezes to 1 line when narrow', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(80),
  })

  expect((await ui.find({ type: 'Text', text: /開始/ }))?.text).toBe('● 開始')
  // 沒有專案名稱時標題只顯示任務名；有 bold 粗體。
  expect((await ui.find({ type: 'Text', text: 'demo' }))?.props.bold).toBe(true)
  // 步驟符號跟標籤分成兩個 Text（中間隔一個固定寬度的欄），不再是同一個字串。
  // 用 ^○$ 鎖死只比對步驟符號本身——tabs 列裡「○ 實作」這種還沒到的階段也含「○」，
  // 不加頭尾錨點會比對到那邊去。
  expect((await ui.find({ type: 'Text', text: /^○$/ }))?.text).toBe('○')
  expect((await ui.find({ type: 'Text', text: 'grill-with-docs' }))?.text).toBe('grill-with-docs')
  expect((await ui.find({ type: 'Text', text: /^下一步/ }))?.text).toBe('下一步：請輸入 /grill-with-docs，把需求問到能拿來驗收')
  expect(await ui.find({ type: 'Text', text: '資產' })).toBeUndefined()
  // steps-only（沒有旁邊的資產框要分寬度）：步驟框滿版，不限制寬度。
  const stepsOnlyBoxes = await ui.findAll({ type: 'Box' })
  expect(stepsOnlyBoxes.some(box => box.props.borderStyle !== undefined && box.props.width === '40%')).toBe(false)
  // 步驟符號欄固定寬度 2、不收縮，同一欄每一列對齊。
  expect(stepsOnlyBoxes.some(box => box.props.width === 2 && box.props.flexShrink === 0)).toBe(true)

  await ui.redraw(ABOVE_PROMPT(120))
  expect(await ui.find({ type: 'Text', text: '資產' })).toBeDefined()
  // two-box（並排兩框）：步驟框限制 40% 寬度，留給資產框。
  const twoBoxBoxes = await ui.findAll({ type: 'Box' })
  expect(twoBoxBoxes.some(box => box.props.borderStyle !== undefined && box.props.width === '40%')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /還沒有資產/ })).toBeDefined()
  // 標題跟著寬度放寬也還在，不是 steps-only 專屬的畫法。
  expect((await ui.find({ type: 'Text', text: 'demo' }))?.props.bold).toBe(true)

  await ui.redraw(ABOVE_PROMPT(30))
  const narrowLines = await ui.findAll({ type: 'Text' })
  expect(narrowLines.length).toBe(1)
  // 中文字一個字佔兩個 cell，model 層不再用字元數裁切；視覺上的裁切交給 wrap="truncate-end"
  // 配合外層 Box 的欄寬，這裡只能驗證「有要求裁切」跟「容器寬度對得上」，裁切後的實際顯示
  // 字數量不到終端機渲染那層看不到。
  expect(narrowLines[0]?.props.wrap).toBe('truncate-end')
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(box => box.props.width === 30)).toBe(true)

  await ui.unmount()
})

test('the rendered band — borders and the box title included — never exceeds min(13, maxRows) total rows, for maxRows 3..15', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120, 10),
  })

  for (let maxRows = 3; maxRows <= 15; maxRows += 1) {
    await ui.redraw(ABOVE_PROMPT(120, maxRows))
    const total = visualLineCount(await ui.drawn())
    expect(total).toBeLessThanOrEqual(Math.min(13, maxRows))
  }

  await ui.unmount()
})

test('the rendered band with the tickets-changed warning row showing never exceeds min(13, maxRows) either, at both steps-only (80) and two-box (120) widths', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')
  await $.skill.prompt({ skill: 'x:grill-with-docs', text: '/grill-with-docs' })
  await $.skill.prompt({ skill: 'x:approach', text: '/approach' })
  await $.skill.prompt({ skill: 'x:to-spec', text: '/to-spec' })
  await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
  await run('mission-skip', 'create-worktree 測試情境不需要真的建')
  await run('mission-next')
  // 進入實作階段之後又跑了一次 to-tickets，band 要多畫一行警告。
  await $.skill.prompt({ skill: 'x:to-tickets', text: '/to-tickets' })

  for (const bodyColumns of [80, 120]) {
    const ui = await $.ui.mount({
      plugin: 'mission-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: ABOVE_PROMPT(bodyColumns, 10),
    })

    expect(await ui.find({ type: 'Text', text: '票數有變動，檢查 issue 描述要不要同步' })).toBeDefined()

    for (let maxRows = 3; maxRows <= 15; maxRows += 1) {
      await ui.redraw(ABOVE_PROMPT(bodyColumns, maxRows))
      const total = visualLineCount(await ui.drawn())
      expect(total).toBeLessThanOrEqual(Math.min(13, maxRows))
    }

    await ui.unmount()
  }
})

test('a mid-session root change (e.g. /cd or EnterWorktree) is read live, not cached from session.start', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo-a')
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  await run('mission-start', 'alpha')

  setRoot('/repo-b')
  await $.session.start({ cwd: '/repo-b', surface: null, isInteractive: false })
  await run('mission-start', 'beta')

  // 回到「這個 session」原本在 repo-a 的狀態；接著模擬 /cd 或搬 worktree 中途換到
  // repo-b，但不重新呼叫 session.start——root 要即問即答才會跟著這次 setRoot 換過去，
  // 快取在 session.start 的話，接下來的事件還是會錯誤地記到 repo-a 的 alpha 上。
  await $.session.start({ cwd: '/repo-a', surface: null, isInteractive: false })
  setRoot('/repo-b')
  await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'hi' })

  const logB = await run('mission-log')
  expect(logB.text).toContain('grill-with-docs')

  setRoot('/repo-a')
  const logA = await run('mission-log')
  expect(logA.text).toBe('還沒有事件')
})

test('prompt.submit refreshes the band after another session changed the store directly', async ($, on) => {
  mock.clock(on)
  // 這裡故意不用 mock.store：要在測試中途直接改 store 的內容來模擬「另一個 session」寫入，
  // 用自己接 store.get／store.set 的 Map 才能從外面動它。
  const storeMap = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: storeMap.get(e.key) }))
  on('store.set', (_, e) => {
    storeMap.set(e.key, e.value)
    return { value: undefined }
  })
  const setRoot = setupRoot(on)
  // prompt.submit 不需要真的開一個 turn：這裡直接當它的底層回答，次層的 register.tsx
  // 自己的 hook 跑完該做的事（重讀 store）後呼叫 next(e)，會落到這裡就直接結束。
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // 任務被清掉之後，band 的 hook 自己會 return next(e)（畫不出東西）；底層要有人接住，
  // 就像引擎真的什麼都不畫一樣，回一個沒有子元素的 Box，查 Text 自然會是 0 筆。
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(80),
  })
  expect((await ui.find({ type: 'Text', text: 'grill-with-docs' }))?.text).toBe('grill-with-docs')

  // 模擬「另一個 session」把這個任務做完清除掉：直接改 store 的 map，不經過這個 session 的指令。
  storeMap.set('missions', {})

  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await ui.redraw(ABOVE_PROMPT(80))
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)

  await ui.unmount()
})

describe('progress context for the model', () => {
  function setup(on: On, root = '/repo', repo: TestSessionRepo | null = null) {
    mock.clock(on)
    mock.store(on)
    let sessionId = 'sess-1'
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: root }))
    on('session.repo', () => ({ value: repo }))
    on('session.id', () => ({ value: sessionId }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    const contexts: (readonly string[] | undefined)[] = []
    on('prompt.submit', (_, e) => {
      contexts.push(e.context)
      return { text: e.text, context: e.context }
    })
    on('session.compact', (_, e) => ({ messages: e.messages }))
    return { contexts, setSessionId: (id: string) => (sessionId = id) }
  }
  const run = ($: Engine, command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
  const submit = ($: Engine, text: string, extra: { command?: { name: string; args: string }; isMeta?: true } = {}) =>
    $.prompt.submit({ text, ...extra, wait: false, origin: { kind: 'composer' } })
  const endTurn = ($: Engine, agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId === undefined ? {} : { agentId }) })
  const progressIn = (context: readonly string[] | undefined) => context?.find(c => c.startsWith('[mission-band 任務進度]'))
  const start = async ($: Engine) => {
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run($, 'mission-start', 'demo')
  }

  test('attaches the progress on the first prompt and not again while it is unchanged', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, 'hi')
    await endTurn($)
    await submit($, 'again')

    expect(progressIn(contexts[0])).toContain('目前在「開始」階段')
    expect(progressIn(contexts[1])).toBeUndefined()
  })

  test('attaches the new progress after a step changed it', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, 'hi')
    await endTurn($)
    await $.skill.prompt({ skill: 'mattpocock-skills:grill-with-docs', text: 'x' })
    await submit($, 'next?')

    expect(progressIn(contexts[1])).toContain('grill-with-docs')
    expect(progressIn(contexts[1])).not.toBe(progressIn(contexts[0]))
  })

  test('a prompt whose turn never ran (dropped, or a command that skips the model) is attached again next time', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, '/model', { command: { name: 'model', args: '' } })
    await submit($, 'hi')

    expect(progressIn(contexts[0])).toContain('目前在「開始」階段')
    expect(progressIn(contexts[1])).toBe(progressIn(contexts[0]))
  })

  test('a subagent turn ending does not count as the model having read it', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, 'hi')
    await endTurn($, 'sub-1')
    await submit($, 'again')

    expect(progressIn(contexts[1])).toBe(progressIn(contexts[0]))
  })

  test('/mission-* commands and meta prompts carry nothing', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, '/mission-log', { command: { name: 'mission-log', args: '' } })
    await submit($, 'x', { isMeta: true })
    await submit($, 'hi')

    expect(progressIn(contexts[0])).toBeUndefined()
    expect(progressIn(contexts[1])).toBeUndefined()
    expect(progressIn(contexts[2])).toContain('目前在「開始」階段')
  })

  test('attaches the same progress again after the main conversation was compacted, not after a subagent one', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, 'hi')
    await endTurn($)
    await $.session.compact({ trigger: 'manual', agentId: 'sub-1', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    await submit($, 'after subagent compact')
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
    await submit($, 'after compact')

    expect(progressIn(contexts[1])).toBeUndefined()
    expect(progressIn(contexts[2])).toBe(progressIn(contexts[0]))
  })

  test('a new session id (after /clear) attaches the same progress again', async ($, on) => {
    // 任務綁 worktree 路徑，換 session id 還是同一個任務、進度文字也一樣，只有 session 換了。
    const wt = '/main/.claude/worktrees/demo'
    const { contexts, setSessionId } = setup(on, wt, { root: '/main', remote: null, internal: false, name: 'repo' })
    await start($)
    await submit($, 'hi')
    await endTurn($)
    await submit($, 'same session')
    setSessionId('sess-2')
    await submit($, 'after clear')

    expect(progressIn(contexts[0])).toContain('任務 ')
    expect(progressIn(contexts[1])).toBeUndefined()
    expect(progressIn(contexts[2])).toBe(progressIn(contexts[0]))
  })

  test('says once that the mission is gone after /mission-finish', async ($, on) => {
    const { contexts } = setup(on)
    await start($)
    await submit($, 'hi')
    await endTurn($)
    await run($, 'mission-finish', 'demo --force')
    await submit($, 'done?')
    await endTurn($)
    await submit($, 'again')

    expect(contexts[1]).toContain(NO_MISSION_TEXT)
    expect(progressIn(contexts[2])).toBeUndefined()
  })

  test('attaches nothing in a session with no mission', async ($, on) => {
    const { contexts } = setup(on)
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await submit($, 'hi')

    expect(progressIn(contexts[0])).toBeUndefined()
  })
})

test('two sessions analysing in the main checkout each keep their own mission, and a worktree picks one up by #issue', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let root = '/main'
  let sessionId = 'sess-a'
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: sessionId }))
  on('session.repo', () => ({ value: { root: '/main', remote: null, internal: false, name: 'repo' } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: root, surface: null, isInteractive: false })
  const startA = await run('mission-start', '#473')
  expect(startA.text).toMatch(/已建立任務「\d{4}-#473」/)

  sessionId = 'sess-b'
  await $.session.start({ cwd: root, surface: null, isInteractive: false })
  const startB = await run('mission-start', 'ctbc-layout')
  expect(startB.text).toContain('已建立')

  root = '/main/.claude/worktrees/feat_x'
  sessionId = 'sess-c'
  await $.session.start({ cwd: root, surface: null, isInteractive: false })
  const restored = await run('mission-restore', '#473')
  expect(restored.text).toContain('#473')

  const list = await run('mission-list')
  expect(list.text).toMatch(/#473.*feat_x.*← 目前/)
  expect(list.text).toMatch(/ctbc-layout.*主 checkout/)
})

test('mission-start with #<issue> seeds a clickable asset built from the repo remote', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({
    value: { root: '/repo', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' },
  }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', '#473')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://example.com/org/repo/-/issues/473')
  expect(link?.children).toEqual(['#473'])

  await ui.unmount()
})

test('a /grill-with-docs prompt with a gitlab issue url picks it up as an asset', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.prompt.submit({ text: '/grill-with-docs 參考 https://git.example.com/a/b/-/issues/9', wait: false, origin: { kind: 'composer' } })

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://git.example.com/a/b/-/issues/9')
  expect(link?.children).toEqual(['b#9'])

  await ui.unmount()
})

test('a Bash hook reading an issue (glab api .../issues/...) picks up the url from stdout', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
  on('tool.call', () => ({ result: { stdout: '看 https://git.example.com/a/b/-/issues/187 這張票', stderr: '', interrupted: false } }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.tool.call({ tool: 'Bash', command: 'glab api "projects/524/issues/187"' })

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  const link = await ui.find({ type: 'Link' })
  expect(link?.props.href).toBe('https://git.example.com/a/b/-/issues/187')
  expect(link?.children).toEqual(['b#187'])

  await ui.unmount()
})

test('a Bash hook reading an issue picks up urls out of realistic unparsed JSON stdout (glab api prints JSON, not plain text)', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
  // 真實 glab api 印出來的就是這種沒解析過的 JSON：`\/` 轉義、換行是字面上的 \n（不是真的斷行）、
  // figma 連結的 & 被跳脫成 &。
  const stdout =
    '{"description":"PM: https:\\/\\/git.fugle.tw\\/a\\/rsc-pm\\/-\\/work_items\\/187\\nfigma https:\\/\\/www.figma.com\\/design\\/X\\/Y?node-id=1-2\\u0026t=zz"}'
  on('tool.call', () => ({ result: { stdout, stderr: '', interrupted: false } }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.tool.call({ tool: 'Bash', command: 'glab api "projects/524/issues/187"' })

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  const links = await ui.findAll({ type: 'Link' })
  const hrefs = links.map(link => link.props.href)
  expect(hrefs).toContain('https://git.fugle.tw/a/rsc-pm/-/work_items/187')
  expect(hrefs).toContain('https://www.figma.com/design/X/Y?node-id=1-2&t=zz')

  await ui.unmount()
})

test('a Bash command unrelated to reading an issue does not scan stdout for assets', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  await $.tool.call({ tool: 'Bash', command: 'cat README.md' })

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()

  await ui.unmount()
})

test('mission-start refuses when pstack has not been set up, and creates no mission', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: false }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  const refused = await run('mission-start', 'demo')
  expect(refused.text).toContain('/setup-pstack')

  const list = await run('mission-list')
  expect(list.text).toBe('目前沒有任務')
})

test('/mission-link adds a clickable asset and /mission-unlink removes it', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const linked = await run('mission-link', '設計稿 https://www.figma.com/design/abc/x')
  expect(linked.text).toContain('已加入')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://www.figma.com/design/abc/x')

  const unlinked = await run('mission-unlink', '設計稿')
  expect(unlinked.text).toContain('已刪除')
  await ui.redraw(ABOVE_PROMPT(120))
  expect(await ui.find({ type: 'Link' })).toBeUndefined()

  await ui.unmount()
})

test('the title uses the project short name derived from the remote, not the worktree directory name, when a remote exists', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  // session.root() 故意跟 repo.root 不同（worktree 路徑 vs 主 checkout）：標題要跟著
  // remote 算出來的短名「repo」，不能錯用 session.root() 的最後一段「feat-a」。
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/main-checkout/.worktrees/feat-a' }))
  on('session.repo', () => ({
    value: { root: '/main-checkout', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' },
  }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: '/main-checkout/.worktrees/feat-a', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  // mission-start 會把今天的日期（mock.clock 從 epoch 起算，固定是 0101）加進任務名，
  // 標題要用 regex 比對，不能寫死成 'repo > demo'。
  expect(await ui.find({ type: 'Text', text: /^repo > \d{4}-demo$/ })).toBeDefined()

  await ui.unmount()
})

test('the title falls back to the last segment of repo.root (not session.root()) when the repo has no remote', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  // session.root() 故意跟 repo.root 不同：沒有 remote 時要退回 repo.root 的最後一段
  // 「main-checkout」，不能錯用 session.root() 的 worktree 路徑段「feat-x」。
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/main-checkout/.worktrees/feat-x' }))
  on('session.repo', () => ({ value: { root: '/main-checkout', remote: null, internal: false, name: 'repo' } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  mock.env(on, { HOME: '/home/x' })
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))

  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  await $.session.start({ cwd: '/main-checkout/.worktrees/feat-x', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  expect(await ui.find({ type: 'Text', text: /^main-checkout > \d{4}-demo$/ })).toBeDefined()

  await ui.unmount()
})

test('the title shows only the mission name, with no project prefix, outside a repo (session.repo() is null)', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const setRoot = setupRoot(on)
  const run = (command: string, args = '') =>
    $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

  setRoot('/repo')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await run('mission-start', 'demo')

  const ui = await $.ui.mount({
    plugin: 'mission-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: ABOVE_PROMPT(120),
  })
  expect((await ui.find({ type: 'Text', text: 'demo' }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: / > demo/ })).toBeUndefined()

  await ui.unmount()
})

// process.run 的回應依 argv 分岔：symbolic-ref 給預設分支、git log 給 commit 清單、
// 其他（例如 glab api）用 other 客製；沒對到任何分支一律當失敗。
function mockProcessRun(
  on: On,
  options: { symbolicRef?: { exitCode: number; stdout: string }; log?: { exitCode: number; stdout: string }; other?: { exitCode: number; stdout: string } },
) {
  on('process.run', (_, e) => {
    const [cmd, sub] = e.argv
    if (cmd === 'git' && sub === 'symbolic-ref') {
      const r = options.symbolicRef ?? { exitCode: 0, stdout: 'origin/main\n' }
      return { value: { exitCode: r.exitCode, stdout: r.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd === 'git' && sub === 'log') {
      const r = options.log ?? { exitCode: 0, stdout: '' }
      return { value: { exitCode: r.exitCode, stdout: r.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const r = options.other ?? { exitCode: 1, stdout: '' }
    return { value: { exitCode: r.exitCode, stdout: r.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

// 把任務從「開始」帶進「實作」階段：grill 跟 to-spec 給事件，prototype／to-tickets
// 從沒碰過也不擋路（見 model.test.ts 的「an optional node that was never started…」）。
async function advanceToBuildStage($: Engine, run: (command: string, args?: string) => Promise<unknown>) {
  await $.skill.prompt({ skill: 'x:grill-with-docs', text: '/grill-with-docs' })
  await $.skill.prompt({ skill: 'x:approach', text: '/approach' })
  await $.skill.prompt({ skill: 'x:to-spec', text: '/to-spec' })
  // create-worktree 是必做節點，但這裡故意跳過不真的建 worktree：mission.worktreePath 留空，
  // 讓下面這組測試繼續驗 currentBranchCommits 用 session root 查 git 的既有行為。
  await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
  await run('mission-skip', 'create-worktree 測試情境不需要真的建')
  await run('mission-next')
}

describe('commit snapshot (branchCommits)', () => {
  test('a foreground Bash tool.call updates the branch commit snapshot, shown as a commit count on implement', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    mockProcessRun(on, { log: { exitCode: 0, stdout: 'abc123\t1700000000\n' } })
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await advanceToBuildStage($, run)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /implement（1 commits）/ })).toBeDefined()
    await ui.unmount()
  })

  test('git log exiting non-zero leaves the snapshot unchanged (no commit count shown)', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    mockProcessRun(on, { log: { exitCode: 128, stdout: '' } })
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await advanceToBuildStage($, run)
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /commits/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a rejecting $.process.run leaves the snapshot unchanged and does not throw out of the hook, from both a Bash tool.call and a turn.complete', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })

    let processRunCalls = 0
    on('process.run', () => {
      processRunCalls += 1
      throw new Error('git not found')
    })
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await advanceToBuildStage($, run)

    // 實際驅動兩條會查 git 的路徑：foreground Bash 的 tool.call，跟背景 Bash 結束後的 turn.complete。
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    // 這條斷言證明上面兩次呼叫真的打到了 $.process.run（不是空測）。
    expect(processRunCalls).toBeGreaterThan(0)
    // currentBranchCommits 自己的 try/catch 把錯誤攔下來才會印這句；拿掉它之後，
    // 錯誤會直接被外層通用的 .catch(next(e)) 吞掉、不會留下這句訊息，這裡就會偵測到變化。
    const snapshotLogs = logs.filter(text => text.includes('讀取分支 commit 快照失敗'))
    expect(snapshotLogs.length).toBeGreaterThanOrEqual(2)

    // 丟出去的錯誤沒有把整個 hook 炸掉，指令還是正常跑完。
    const result = await run('mission-log')
    expect(result.text).toContain('skill')

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /commits/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a background Bash leaves no stdout, but its turn.complete still refreshes the snapshot', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    mockProcessRun(on, { log: { exitCode: 0, stdout: 'bg0001\t1700000000\n' } })
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await advanceToBuildStage($, run)
    // 背景 Bash 本身沒有 stdout、也不會觸發完成事件；它結束時觸發的是下一個 turn。
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /implement（1 commits）/ })).toBeDefined()
    await ui.unmount()
  })

  test('a subagent turn.complete (with agentId) does not refresh the snapshot — its own Bash calls already did', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    mockProcessRun(on, { log: { exitCode: 0, stdout: 'sub0001\t1700000000\n' } })
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await advanceToBuildStage($, run)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'sub-1' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /commits/ })).toBeUndefined()
    await ui.unmount()
  })

  test('no mission bound here: nothing is queried and nothing is written', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    let called = false
    on('process.run', () => {
      called = true
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    setRoot('/repo-unbound')
    await $.session.start({ cwd: '/repo-unbound', surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })

    expect(called).toBe(false)
  })

  test('once worktreePath is recorded, a later commit snapshot is queried from the worktree directory, not session root', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const WORKTREE = '/repo/.claude/worktrees/feat_x'
    const seenCwds: string[] = []
    on('process.run', (_, e) => {
      // git worktree add 記路徑前要先驗過 rev-parse；這支呼叫沒有 cwd（git -C 自己帶目標）。
      if (e.argv.includes('rev-parse')) return { value: { exitCode: 0, stdout: `${WORKTREE}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      const cwd = e.init?.cwd ?? ''
      seenCwds.push(cwd)
      if (e.argv[1] === 'symbolic-ref') return { value: { exitCode: 0, stdout: 'origin/main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (e.argv[1] === 'log') {
        const stdout = cwd === WORKTREE ? 'abc123\t1700000000\n' : ''
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    // 這次 Bash 本身，worktreePath 還沒記進任務（偵測在這次快照查完之後才跑），快照查詢仍問 session root。
    await $.tool.call({ tool: 'Bash', command: `git worktree add ${WORKTREE} -b feat_x` })
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.skill.prompt({ skill: 'x:approach', text: 'hi' })
    await $.skill.prompt({ skill: 'x:to-spec', text: 'hi' })
    await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
    await run('mission-next')
    // 這次 Bash，worktreePath 已經記好了，快照改問 worktree 目錄。
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /implement（1 commits）/ })).toBeDefined()
    expect(seenCwds).toContain(WORKTREE)
    await ui.unmount()
  })

  test('once worktreePath is set, git failing there does not fall back to session root — the snapshot just stays unchanged', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const WORKTREE = '/repo/.claude/worktrees/feat_x'
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    let worktreeRecorded = false
    on('process.run', (_, e) => {
      if (e.argv.includes('rev-parse')) {
        worktreeRecorded = true
        return { value: { exitCode: 0, stdout: `${WORKTREE}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      // worktree 目錄本身的 git 指令之後整個失敗，模擬目錄不見了；session root 這邊故意留著
      // 一個「worktreePath 定下來之後」才查得到的 commit——如果程式碼退回去查 root（不該
      // 發生），這顆 commit 會被誤算進這個任務的快照，拿來證明「真的沒有 fallback」，不是
      // 巧合地兩邊都查不到東西（worktreePath 還沒定下來之前查 root 是正常流程，不算 fallback）。
      if (e.init?.cwd === WORKTREE) throw new Error('ENOENT: worktree 目錄不見了')
      if (e.argv[1] === 'symbolic-ref') return { value: { exitCode: 0, stdout: 'origin/main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (e.argv[1] === 'log') {
        const stdout = worktreeRecorded ? 'abc123\t1700000000\n' : ''
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: `git worktree add ${WORKTREE} -b feat_x` })
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.skill.prompt({ skill: 'x:to-spec', text: 'hi' })
    await run('mission-next')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /commits/ })).toBeUndefined()
    expect(logs.some(text => text.includes('暫不更新'))).toBe(true)
    expect(logs.some(text => text.includes('改用 session root'))).toBe(false)
    await ui.unmount()
  })
})

describe('worktree path detection', () => {
  // 這組測試在「開始」階段偵測 worktreePath，但「開始」階段現在有 6 個節點，超過band
  // 預設高度能放的 5 列（見 band.test.ts 的「more than 6 rows...」）；create-worktree
  // 的 step 文字常被截到「另有 N 列」裡，ui.find 找不到不代表沒偵測到，直接讀 store 比對
  // mission.worktreePath 才是真的在驗這組測試的主張；巢狀深度本身已經在
  // products.test.ts 的 cdWorktreeCandidatePath 單元測試驗過，這裡只驗兩端有接起來。
  const REPO = { root: '/repo', remote: null, internal: true, name: 'repo' }

  // mission-start 會自動在名稱前面加日期（例如 demo → 0101-demo，見 command-args.ts 的
  // parseStartArgs），這組測試只建一個任務，直接取 Object.values 的唯一一筆，不要猜日期。
  function missionWorktreePath(storeMap: Map<string, unknown>): string | undefined {
    const missions = storeMap.get('missions') as Missions | undefined
    return Object.values(missions ?? {})[0]?.worktreePath
  }

  function mockWorktreeProcessRun(on: On, options: { revParse?: { exitCode: number; stdout: string } }) {
    on('process.run', (_, e) => {
      if (e.argv[0] === 'git' && e.argv.includes('rev-parse')) {
        const r = options.revParse ?? { exitCode: 1, stdout: '' }
        return { value: { exitCode: r.exitCode, stdout: r.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      // symbolic-ref／log 這裡不關心，給安全的失敗讓 commit 快照自己跳過，不干擾這組測試。
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
  }

  test('orca worktree create: the path comes from stdout’s worktree.path JSON field', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ result: { stdout: JSON.stringify({ worktree: { path: '/repo/wt' } }), stderr: '', interrupted: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'orca worktree create wt -b feat_x' })

    expect(missionWorktreePath(storeMap)).toBe('/repo/wt')
  })

  test('orca worktree create with stdout redirected to a file: falls back to --name and git worktree list', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ result: { stdout: 'exit=0\n{"ok":true}\n', stderr: '', interrupted: false } }))
    const listCalls: string[][] = []
    on('process.run', (_, e) => {
      if (e.argv.includes('worktree') && e.argv.includes('list')) {
        listCalls.push([...e.argv])
        const porcelain = 'worktree /repo\nHEAD a\nbranch refs/heads/main\n\nworktree /repo/.claude/worktrees/rsc-frontend/bug_x\nHEAD b\nbranch refs/heads/bug_x\n'
        return { value: { exitCode: 0, stdout: porcelain, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'orca worktree create --name bug_x --base-branch origin/main --json > /tmp/o.json 2>&1; echo "exit=$?"' })

    expect(listCalls).toContainEqual(['git', '-C', '/repo', 'worktree', 'list', '--porcelain'])
    expect(missionWorktreePath(storeMap)).toBe('/repo/.claude/worktrees/rsc-frontend/bug_x')
  })

  test('orca worktree create fallback never records the main checkout, even when it is on the same branch', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ result: { stdout: 'exit=1\n', stderr: '', interrupted: false } }))
    on('process.run', (_, e) => {
      if (e.argv.includes('worktree') && e.argv.includes('list')) {
        const porcelain = 'worktree /repo\nHEAD a\nbranch refs/heads/bug_x\n'
        return { value: { exitCode: 0, stdout: porcelain, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'orca worktree create --name bug_x --json > /tmp/o.json 2>&1; echo "exit=$?"' })

    expect(missionWorktreePath(storeMap)).toBeUndefined()
  })

  test('git worktree add: a relative path is resolved against session.root()', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on)
    // git worktree add 解析出的路徑要先過 git -C <path> rev-parse 驗過（exit 0）才會被記下來。
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'git worktree add wt -b feat_x' })

    expect(missionWorktreePath(storeMap)).toBe('/repo/wt')
  })

  test('git worktree add: a command that itself failed (so the directory is not a real worktree) is not trusted — rev-parse catches it', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on)
    // rev-parse 失敗（exit 128，git 本身的失敗碼）：這條指令雖然解析得出路徑字串，
    // 但 `git worktree add` 這個 Bash 指令本身大概沒有真的成功，所以不該被記下來。
    on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'git worktree add wt -b feat_x' })

    expect(missionWorktreePath(storeMap)).toBeUndefined()
  })

  test('cd into .claude/worktrees/: verified via git -C <path> rev-parse --show-toplevel before trusting it', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on, REPO)
    // rev-parse 回的根目錄本身也要落在 worktree 目錄底下才會被信任；字串層的候選路徑
    // （cd 進去的巢狀子目錄）跟 git 驗出來的真正根目錄不必是同一個字串。
    mockWorktreeProcessRun(on, { revParse: { exitCode: 0, stdout: '/repo/.worktrees/wt\n' } })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'cd /repo/.claude/worktrees/rsc-frontend/feat_x && git status' })

    expect(missionWorktreePath(storeMap)).toBe('/repo/.worktrees/wt')
  })

  test('cd candidate that git itself rejects (non-zero exit) is not trusted, create-worktree stays not-started', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on, REPO)
    mockWorktreeProcessRun(on, { revParse: { exitCode: 128, stdout: '' } })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'cd /repo/.claude/worktrees/feat_x && git status' })

    expect(missionWorktreePath(storeMap)).toBeUndefined()
  })

  test('the latest detected path wins over an earlier one', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on)
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'git worktree add wt-a -b feat_a' })
    await $.tool.call({ tool: 'Bash', command: 'git worktree add wt-b -b feat_b' })

    expect(missionWorktreePath(storeMap)).toBe('/repo/wt-b')
  })

  test('a Bash call from a subagent (agentId set) never drives worktree detection, even a real git worktree add', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on)
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    // $.tool.call 的型別目前漏了 Bash 這支內建工具的 AgentLoop 疊加（向 claude-code 回報過的
    // 型別落差，不影響實際跑的行為），這裡窄窄轉型繞過，不要整段退回 any。
    const toolCall = $.tool.call as (input: { tool: 'Bash'; command: string; agentId: string }) => Promise<unknown>
    await toolCall({ tool: 'Bash', command: 'git worktree add wt -b feat_x', agentId: 'sub-1' })

    expect(missionWorktreePath(storeMap)).toBeUndefined()
  })

  test('a cd detection only fills worktreePath when it is still unset — it never overwrites an existing one', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on, { root: '/repo', remote: null, internal: true, name: 'repo' })
    const revParseCalls: string[] = []
    on('process.run', (_, e) => {
      if (e.argv.includes('rev-parse')) {
        revParseCalls.push(e.argv[2] ?? '')
        return { value: { exitCode: 0, stdout: '/repo/.claude/worktrees/other\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'git worktree add wt -b feat_x' })
    // worktreePath 已經是 /repo/wt 了；就算這次 cd 進一個看起來也合法的 worktree 目錄，
    // 字串層的候選路徑比對就不該再往下查 git，更不該覆蓋掉已經定下來的路徑。
    await $.tool.call({ tool: 'Bash', command: 'cd /repo/.claude/worktrees/other && git status' })

    expect(missionWorktreePath(storeMap)).toBe('/repo/wt')
    expect(revParseCalls).not.toContain('/repo/.claude/worktrees/other')
  })
})

describe('tool.call Bash: one step failing does not block the others', () => {
  // 用短路徑：同一條理由見「worktree path detection」那組測試開頭的註解。
  const WORKTREE = '/repo/.worktrees/x'

  test('the commit-snapshot step throwing all the way out (not the usual git failure it already catches internally) does not stop worktree path detection from running afterwards', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    // 不能用 setupRoot：這裡要讓 $.session.root() 只在「commit 快照那一步自己查 cwd」
    // 時丟例外，其他呼叫點（currentBinding 先查一次、/mission-start 當時查的那些）都要
    // 正常回應，所以自己控制呼叫次數，不能沿用 setupRoot 寫死、不分情境的版本。
    let armedCallCount = 0
    let armed = false
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => {
      if (armed) {
        armedCallCount += 1
        // 這次 Bash 的 try 區塊裡，session.root() 第一次被呼叫是 currentBinding() 自己要
        // 算 binding；第二次才是 maybeUpdateBranchCommits 查 cwd（mission 還沒有
        // worktreePath），刻意只讓這一次丟例外，模擬「這步本身，不是它內部的 git 呼叫」失敗。
        if (armedCallCount === 2) throw new Error('boom from session.root')
      }
      return { value: '/repo' }
    })
    on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: true, name: 'repo' } }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    on('tool.call', () => ({ result: {} }))
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    on('process.run', (_, e) => {
      if (e.argv.includes('rev-parse')) {
        return { value: { exitCode: 0, stdout: `${WORKTREE}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')

    armed = true
    await $.tool.call({ tool: 'Bash', command: `cd ${WORKTREE} && git log -1` })

    // commit 快照那一步真的整個往外炸過，不是空測（測試框架把例外原文包成固定格式的
    // HooksError，訊息本身不保留，所以只驗有記錄到，不鎖死文字內容）。
    expect(logs.length).toBeGreaterThan(0)

    // 「開始」階段現在有 6 個節點，create-worktree 的 step 文字常被截進「另有 N 列」裡
    // （見 band.test.ts 的「more than 6 rows...」），直接讀 store 比對 worktreePath
    // 才是真的在驗「worktree 偵測沒被 commit 快照那步的例外波及」。
    const missions = storeMap.get('missions') as Missions | undefined
    expect(Object.values(missions ?? {})[0]?.worktreePath).toBe(WORKTREE)
  })

  // 開 MR 前補刷新驗收清單（product-events.ts 的 maybeRecordMrEvent → maybeRefreshAcceptance）
  // 如果本身丟例外（store 或 fs 出問題，不是 maybeRefreshAcceptance 內部早就接住的讀檔
  // 失敗——那種情況它自己會轉成 recordReadFailure，不會往外丟），不該讓整個 mr 事件都
  // 記不到；應該繼續沿用 store 裡已經有的 acIds，mr 事件還是要記下來。
  test('maybeRefreshAcceptance 本身丟例外（不是它內部已經接住的讀檔失敗）：mr 事件還是記下來，沿用 store 裡已經有的 acIds', async ($, on) => {
    mock.clock(on)
    const storeMap = new Map<string, unknown>()
    // 這次 Bash 分派裡 store.get 總共被呼叫 8 次：資產記錄一次、分支 commit 快照讀一次、
    // 第 3 次正是 maybeRefreshAcceptance 自己最先做的那次 loadMissions（在它能碰到任何
    // fs／git 呼叫之前）。只讓這一次丟例外，模擬「刷新這一步本身」出問題，其餘讀寫
    // （資產記錄、最後真正記 mr 事件、issue-note／worktree 偵測）都正常運作。
    let getCalls = 0
    let armed = false
    on('store.get', (_, e) => {
      if (armed) {
        getCalls += 1
        if (getCalls === 3) throw new Error('store 或 fs 出問題（模擬 maybeRefreshAcceptance 本身丟例外）')
      }
      return { value: storeMap.get(e.key) }
    })
    on('store.set', (_, e) => {
      storeMap.set(e.key, e.value)
      return { value: undefined }
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.repo', () => ({ value: { root: '/repo', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' } }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    const ACCEPTANCE_PATH = '/repo/.claude/specs/acceptance-473.md'
    on('fs.read', (_, e) => {
      if (e.path === '/tmp/desc.md') return { value: '## 關聯\n## 為什麼要這樣做\n## Summary\n## Merge Danger\n## Evidence\nAC-1 截圖通過' }
      // 這份清單其實有 AC-1／AC-2 兩條，但刷新本身會先丟例外，根本不會讀到這裡——
      // 如果最後 missingAcs 算出了 AC-2，代表刷新失敗卻還是錯誤地用了新清單的內容。
      if (e.path === ACCEPTANCE_PATH)
        return {
          value: ['# 驗收清單：#473 x', '<!-- acceptance:meta {"key":"473"} -->', '', '- 整體回歸：未跑', '', '### AC-1 x', '- 結果：待驗', '', '### AC-2 x', '- 結果：待驗', ''].join(
            '\n',
          ),
        }
      return { value: '# x\n\n## Agent skills\n' }
    })
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('tool.call', () => ({ result: { stdout: '已開：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false } }))
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '473')
    // 模擬這個任務之前已經成功刷新過一次，清單當時只有 AC-1；這次 Bash 觸發的刷新會丟
    // 例外，應該繼續沿用這份舊資料，而不是空陣列、也不是撞到例外前根本沒讀到的新清單。
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) {
      storeMap.set('missions', { ...before, [name]: { ...m, acceptance: { exists: true, acIds: ['AC-1'], readAt: 0 } } })
    }

    armed = true
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh org/repo --title "x" --description "$(cat /tmp/desc.md)"' })

    const after = storeMap.get('missions') as Missions
    const mission = Object.values(after)[0]
    const event = mission?.events.find(e => e.kind === 'product' && e.name === 'mr')
    // mr 事件還是記下來了（沒有因為刷新失敗整個丟掉），而且 missingAcs 是照 acIds=['AC-1']
    // 算的（AC-1 有提到，所以空陣列）——不是新清單的 ['AC-1','AC-2']（那樣 AC-2 會缺）。
    expect(event?.missingAcs).toEqual([])
    expect(mission?.acceptance?.acIds).toEqual(['AC-1'])
    expect(logs.some(text => text.includes('開 MR 前刷新驗收清單失敗'))).toBe(true)
  })
})

describe('codex-review via skill or Agent tool call', () => {
  test('an Agent tool call with a subagent_type is recorded as an agent event', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Agent', description: '第二意見', prompt: 'x', subagent_type: 'codex:codex-rescue' })

    const log = await run('mission-log')
    expect(log.text).toContain('agent codex:codex-rescue')
  })

  test('a recordEvent failure inside the Agent hook is swallowed, not re-dispatched to next(e) a second time', async ($, on) => {
    mock.clock(on)
    const setRoot = setupRootNoToolCall(on)
    let toolCallCount = 0
    on('tool.call', () => {
      toolCallCount += 1
      return { result: {} }
    })
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    // 自己接 store：第一次 set（mission-start）放過，第二次 set（Agent 事件的 recordEvent）
    // 開始丟錯，逼 Agent 的 tool.call hook 走到它自己的 catch，而不是外層那層。
    const storeMap = new Map<string, unknown>()
    let setCalls = 0
    on('store.get', (_, e) => ({ value: storeMap.get(e.key) }))
    on('store.set', (_, e) => {
      setCalls += 1
      if (setCalls > 1) throw new Error('store 壞了')
      storeMap.set(e.key, e.value)
      return { value: undefined }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Agent', description: '第二意見', prompt: 'x', subagent_type: 'codex:codex-rescue' })

    // next(e) 的底層只跑了一次（mission-start 不經過 tool.call，所以這裡只數得到這一次 Agent 呼叫）；
    // 如果錯誤漏到外層的 .catch(($,e,next)=>next(e))，這裡會變成 2。
    expect(toolCallCount).toBe(1)
    expect(logs.some(text => text.includes('處理 Agent 工具呼叫結果失敗'))).toBe(true)

    // 丟出去的錯誤沒有把整個 hook 炸掉，指令還是正常跑完（跟 Bash 那條既有測試的驗證方式一致）。
    const result = await run('mission-log')
    expect(result.text).toBe('還沒有事件')
  })

  test('an Agent tool call with no subagent_type records nothing', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Agent', description: '一般子代理', prompt: 'x' })

    const log = await run('mission-log')
    expect(log.text).toBe('還沒有事件')
  })

  test('code-review turns done (green) once both the Claude and Codex tracks ran', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.skill.prompt({ skill: 'x:approach', text: 'hi' })
    await $.skill.prompt({ skill: 'x:to-spec', text: 'hi' })
    await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
    await run('mission-skip', 'create-worktree 測試情境不需要真的建')
    await run('mission-next')
    await $.skill.prompt({ skill: 'x:implement', text: 'hi' })
    await $.skill.prompt({ skill: 'x:cr', text: 'hi' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    // Claude 的軌道跑過、Codex 還沒：只是 started，不是 done。
    expect((await ui.find({ type: 'Text', text: 'code-review（Claude ✓ · Codex ○）' }))?.props.color).toBe('warning')

    await $.tool.call({ tool: 'Agent', description: '第二意見', prompt: 'x', subagent_type: 'codex:codex-rescue' })
    expect((await ui.find({ type: 'Text', text: 'code-review（Claude ✓ · Codex ✓）' }))?.props.color).toBe('success')
    await ui.unmount()
  })

  test('running the Codex CLI review in Bash also satisfies the Codex track', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.skill.prompt({ skill: 'x:approach', text: 'hi' })
    await $.skill.prompt({ skill: 'x:to-spec', text: 'hi' })
    await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
    await run('mission-skip', 'create-worktree 測試情境不需要真的建')
    await run('mission-next')
    await $.skill.prompt({ skill: 'x:implement', text: 'hi' })
    await $.skill.prompt({ skill: 'x:cr', text: 'hi' })
    await $.tool.call({ tool: 'Bash', command: 'cd /repo && codex review --base main' })

    const log = await run('mission-log')
    expect(log.text).toContain('bash codex review main')

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect((await ui.find({ type: 'Text', text: 'code-review（Claude ✓ · Codex ✓）' }))?.props.color).toBe('success')
    await ui.unmount()
  })

  test('a denied Bash call (next(e) resolves with deny) does not record the Codex CLI review event', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ deny: '使用者拒絕執行' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'codex review --base main' })

    const log = await run('mission-log')
    expect(log.text).toBe('還沒有事件')
  })

  test('a Bash call core marks isError (threw／interrupted／errored) does not record the Codex CLI review event either', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ isError: true, result: { stdout: '', stderr: 'boom', interrupted: true } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'codex review --base main' })

    const log = await run('mission-log')
    expect(log.text).toBe('還沒有事件')
  })

  test('a normal successful Bash call (no deny, no isError) still records the Codex CLI review event', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'codex review --base main' })

    const log = await run('mission-log')
    expect(log.text).toContain('bash codex review main')
  })

  test('a backgrounded Codex CLI review (run_in_background) still records the event at launch', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRootNoToolCall(on)
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg-1' } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'codex review --base main', run_in_background: true })

    const log = await run('mission-log')
    expect(log.text).toContain('bash codex review main')
  })
})

describe('domainDocsDirty on mission-next', () => {
  const REPO = { root: '/main-checkout', remote: null, internal: true, name: 'repo' }

  test('prepends the GLOSSARY／ADR reminder when git status reports changes to those paths', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on, REPO)
    on('process.run', (_, e) => {
      if (e.argv[0] === 'git' && e.argv[1] === 'status') {
        return { value: { exitCode: 0, stdout: ' M GLOSSARY.md\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/main-checkout')
    await $.session.start({ cwd: '/main-checkout', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.skill.prompt({ skill: 'x:approach', text: 'hi' })
    await $.skill.prompt({ skill: 'x:to-spec', text: 'hi' })
    await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
    await run('mission-skip', 'create-worktree 測試情境不需要真的建')

    const outcome = await run('mission-next')
    expect(outcome.text).toContain('GLOSSARY')
  })

  test('omits the reminder when git status is clean', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on, REPO)
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/main-checkout')
    await $.session.start({ cwd: '/main-checkout', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.skill.prompt({ skill: 'x:approach', text: 'hi' })
    await $.skill.prompt({ skill: 'x:to-spec', text: 'hi' })
    await run('mission-skip', 'to-acceptance 測試情境不管驗收清單')
    await run('mission-skip', 'create-worktree 測試情境不需要真的建')

    const outcome = await run('mission-next')
    expect(outcome.text).not.toContain('GLOSSARY')
  })
})

describe('mission-go', () => {
  const WORKTREE = '/main-checkout/.claude/worktrees/feat_x'

  // 開一個名稱帶 #473 的任務，再切到 worktree 目錄用 /mission-restore 接回去——
  // restoreMission 本來就會把非 session 的 binding 記成 worktreePath，不用另外偽造。
  // setRoot 來自呼叫端先呼叫好的 setupRoot(on)——process.run 的客製 mock 要在 setupRoot 之後、
  // 第一次 session.start 之前註冊，跟其他測試的慣例一致。
  async function startBoundToWorktree($: Engine, setRoot: (next: string) => void, run: (command: string, args?: string) => Promise<unknown>) {
    setRoot('/main-checkout')
    await $.session.start({ cwd: '/main-checkout', surface: null, isInteractive: false })
    await run('mission-start', '473')
    setRoot(WORKTREE)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await run('mission-restore', '#473')
  }

  test('no mission bound here', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const outcome = await run('mission-go')
    expect(outcome.text).toBe('這裡沒有綁定任務')
  })

  test('a bound mission with no worktreePath yet explains how to get one', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    const outcome = await run('mission-go')
    expect(outcome.text).toContain('worktree')
    expect(outcome.text).toContain('/mission-skip create-worktree')
  })

  test('on success, launches orca with the exact argv and cwd, and reports the worktree path', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const seenCalls: { argv: readonly string[]; cwd: string | undefined; timeoutMs: number | undefined }[] = []
    on('process.run', (_, e) => {
      seenCalls.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
      return { value: { exitCode: 0, stdout: JSON.stringify({ id: 'x', ok: true, result: {} }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await startBoundToWorktree($, setRoot, run)
    const outcome = await run('mission-go')

    expect(seenCalls).toEqual([
      {
        argv: ['orca', 'agent', 'launch', '--agent', 'claude', '--worktree', `path:${WORKTREE}`, '--prompt', '/mission-restore #473', '--focus', '--json'],
        cwd: WORKTREE,
        timeoutMs: 30000,
      },
    ])
    expect(outcome.text).toBe(`已在 Orca 開新的 claude 分頁（${WORKTREE}），那邊會自動打 /mission-restore #473`)
  })

  test('on a non-zero exit, reports the exit code and stderr’s first line, plus a manual fallback', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    on('process.run', () => ({
      value: { exitCode: 1, stdout: '', stderr: '找不到 orca\n更多細節', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await startBoundToWorktree($, setRoot, run)
    const outcome = await run('mission-go')

    expect(outcome.text).toBe('orca agent launch 失敗（exit 1）：找不到 orca\n可以自己在 worktree 開 claude，再打 /mission-restore #473')
  })

  test('exit 0 but the JSON envelope says ok:false is still treated as a failure', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    on('process.run', () => ({
      value: { exitCode: 0, stdout: JSON.stringify({ ok: false, error: '沒有這個 agent' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await startBoundToWorktree($, setRoot, run)
    const outcome = await run('mission-go')

    expect(outcome.text).toBe('orca agent launch 失敗（exit 0）：沒有這個 agent\n可以自己在 worktree 開 claude，再打 /mission-restore #473')
  })

  test('$.process.run throwing (e.g. orca missing) does not throw out of the command — it reports failure with a manual fallback', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    // 測試框架在 mock handler 直接 throw 時，不保證把那個例外原樣送回呼叫端（它自己可能
    // 改包成一句 HooksError）；這裡只驗「真的有錯誤發生時，指令不會整個炸掉、照樣回文字」，
    // 不鎖死例外訊息的確切內容——跟既有的 「a rejecting $.process.run...」測試同一個判準。
    on('process.run', () => {
      throw new Error('ENOENT: orca not found')
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await startBoundToWorktree($, setRoot, run)
    const outcome = await run('mission-go')

    expect(outcome.text).toContain('orca agent launch 失敗：')
    expect(outcome.text).toContain('可以自己在 worktree 開 claude，再打 /mission-restore #473')
  })

  // 這三個測試驗的是「worktreePath 還沒記下來，但現在的 cwd 本身已經在 worktree 目錄底下」
  // 的補救路徑：不像 startBoundToWorktree 那樣先用 /mission-restore 記過路徑，這裡故意只
  // 停在 /mission-start，讓 mission.worktreePath 維持 undefined，純粹靠 cwd 偵測。
  // 用短路徑：band 的 step 文字會截到 38 字（band.ts 的 MAX_STEP_TEXT_LENGTH），
  // 路徑太長斷言會對不到完整字串（見上面「worktree path detection」描述區塊開頭的註解）。
  const CWD_REPO = { root: '/repo', remote: null, internal: true, name: 'repo' }
  const CWD_WORKTREE = '/repo/.worktrees/x'

  test('no worktreePath yet, but the session cwd is already inside a worktree dir: git rev-parse confirms it, orca launches there, and the mission now has that worktreePath', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    const setRoot = setupRoot(on, CWD_REPO)
    on('session.cwd', () => ({ value: CWD_WORKTREE }))
    const seenCalls: { argv: readonly string[]; cwd: string | undefined }[] = []
    on('process.run', (_, e) => {
      seenCalls.push({ argv: e.argv, cwd: e.init?.cwd })
      if (e.argv.includes('rev-parse')) {
        return { value: { exitCode: 0, stdout: `${CWD_WORKTREE}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 0, stdout: JSON.stringify({ id: 'x', ok: true, result: {} }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    const outcome = await run('mission-go')

    expect(outcome.text).toBe(`已在 Orca 開新的 claude 分頁（${CWD_WORKTREE}），那邊會自動打 /mission-restore demo`)
    expect(seenCalls.some(c => c.argv[0] === 'orca' && c.cwd === CWD_WORKTREE)).toBe(true)

    // 「開始」階段現在有 6 個節點，create-worktree 的 step 文字常被截進「另有 N 列」裡
    // （見 band.test.ts 的「more than 6 rows...」），直接讀 store 比對 worktreePath。
    const missions = storeMap.get('missions') as Missions | undefined
    expect(Object.values(missions ?? {})[0]?.worktreePath).toBe(CWD_WORKTREE)
  })

  test('no worktreePath yet and the cwd is the main checkout itself (not under a worktree dir): still the no-worktree text, no orca call', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on, CWD_REPO)
    on('session.cwd', () => ({ value: '/repo' }))
    let processRunCalled = false
    on('process.run', () => {
      processRunCalled = true
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    const outcome = await run('mission-go')

    expect(outcome.text).toContain('worktree')
    expect(outcome.text).toContain('/mission-skip create-worktree')
    expect(processRunCalled).toBe(false)
  })

  test('the cwd looks like a worktree dir but git rev-parse rejects it (non-zero exit): still the no-worktree text, no orca call', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on, CWD_REPO)
    on('session.cwd', () => ({ value: CWD_WORKTREE }))
    const orcaCalls: string[] = []
    on('process.run', (_, e) => {
      if (e.argv.includes('rev-parse')) {
        return { value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      orcaCalls.push(e.argv[0] ?? '')
      return { value: { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    const outcome = await run('mission-go')

    expect(outcome.text).toContain('/mission-skip create-worktree')
    expect(orcaCalls).toEqual([])
  })
})

describe('MR detection', () => {
  const REPO_WITH_REMOTE = { root: '/repo', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' }

  // 不在這裡註冊 'tool.call'／'fs.read'：每個測試要客製 Bash 的 stdout 或描述檔內容，
  // 自己註冊一次就好，疊兩個 terminal mock 的行為沒有定義，不要靠它。
  function setupRepoWithRemote(on: On) {
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.repo', () => ({ value: REPO_WITH_REMOTE }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
  }

  test('an MR url for this project, found via --description "$(cat <path>)", records an mr event with missing sections read from that file', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    on('fs.read', (_, e) => {
      if (e.path === '/tmp/desc.md') return { value: '## 關聯\n## Summary' }
      return { value: '# x\n\n## Agent skills\n' }
    })
    on('tool.call', () => ({ result: { stdout: '已開：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh org/repo --title "x" --description "$(cat /tmp/desc.md)"' })

    const log = await run('mission-log')
    expect(log.text).toContain('product mr')
    expect(log.text).toContain('缺：為什麼要這樣做、Merge Danger、Evidence')
  })

  test('open-mr 也會檢查驗收清單的 AC id 在 MR 描述的 Evidence 段落裡有沒有被提到，用 mission.acceptance.acIds 比對', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    const ACCEPTANCE_PATH = '/repo/.claude/specs/acceptance-473.md'
    const ACCEPTANCE_TEXT = [
      '# 驗收清單：#473 x',
      '<!-- acceptance:meta {"key":"473"} -->',
      '',
      '- 整體回歸：未跑',
      '',
      '### AC-1 x',
      '- 結果：待驗',
      '',
      '### AC-2 x',
      '- 結果：待驗',
      '',
    ].join('\n')
    on('fs.read', (_, e) => {
      if (e.path === '/tmp/desc.md') return { value: '## 關聯\n## 為什麼要這樣做\n## Summary\n## Merge Danger\n## Evidence\nAC-1 截圖通過' }
      if (e.path === ACCEPTANCE_PATH) return { value: ACCEPTANCE_TEXT }
      return { value: '# x\n\n## Agent skills\n' }
    })
    on('tool.call', () => ({ result: { stdout: '已開：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '473')
    // 不手動塞 acceptance 到 store：開 MR 前會自己刷新一次驗收清單（見 maybeRecordMrEvent
    // 的 maybeRefreshAcceptance 呼叫），任務名帶 #473 直接拼出驗收清單路徑，模擬「這個
    // 任務已經跑過 /to-acceptance，清單有 AC-1／AC-2 兩條」。
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh org/repo --title "x" --description "$(cat /tmp/desc.md)"' })

    const after = storeMap.get('missions') as Missions
    const event = Object.values(after)[0]?.events.find(e => e.kind === 'product' && e.name === 'mr')
    expect(event?.missingAcs).toEqual(['AC-2'])
  })

  test('an MR url for another project is not recorded as this mission’s mr event', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    on('tool.call', () => ({ result: { stdout: '已開：https://example.com/other/project/-/merge_requests/9', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh other/project --title "x" --description "$(cat /tmp/desc.md)"' })

    const log = await run('mission-log')
    expect(log.text).not.toContain('product mr')
  })

  test('when the description file cannot be read, it falls back to glab api for the MR description', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {
      other: { exitCode: 0, stdout: JSON.stringify({ description: '## 關聯\n## 為什麼要這樣做\n## Summary\n## Merge Danger\n## Evidence' }) },
    })
    on('fs.read', (_, e) => {
      if (e.path === '/tmp/desc.md') throw new Error('ENOENT')
      return { value: '# x\n\n## Agent skills\n' }
    })
    on('tool.call', () => ({ result: { stdout: '已更新：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'mr-update.sh org/repo 9 --description "$(cat /tmp/desc.md)"' })

    const log = await run('mission-log')
    expect(log.text).toContain('product mr')
    expect(log.text).not.toContain('缺：')
  })

  test('a description path starting with ~/ is expanded against $.env.get("HOME") before $.fs.read', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    let readPath: string | undefined
    on('fs.read', (_, e) => {
      readPath = e.path
      if (e.path === '/home/x/scratchpad/desc.md') return { value: '## 關聯\n## 為什麼要這樣做\n## Summary\n## Merge Danger\n## Evidence' }
      return { value: '# x\n\n## Agent skills\n' }
    })
    on('tool.call', () => ({ result: { stdout: '已開：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh org/repo --title "x" --description "$(cat ~/scratchpad/desc.md)"' })

    expect(readPath).toBe('/home/x/scratchpad/desc.md')
    const log = await run('mission-log')
    expect(log.text).toContain('product mr')
    expect(log.text).not.toContain('缺：')
  })

  test('a relative description path is resolved against session.root()', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    on('fs.read', (_, e) => {
      if (e.path === '/repo/scratchpad/desc.md') return { value: '## 關聯\n## 為什麼要這樣做\n## Summary\n## Merge Danger\n## Evidence' }
      return { value: '# x\n\n## Agent skills\n' }
    })
    on('tool.call', () => ({ result: { stdout: '已開：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh org/repo --title "x" --description "$(cat scratchpad/desc.md)"' })

    const log = await run('mission-log')
    expect(log.text).toContain('product mr')
    expect(log.text).not.toContain('缺：')
  })

  test('a --dry-run run is ignored even though stdout mentions an MR url for this project', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    on('tool.call', () => ({
      result: { stdout: '[DRY-RUN] body: {"web_url":"https://example.com/org/repo/-/merge_requests/9"}', stderr: '', interrupted: false },
    }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'mr-create.sh org/repo --title "x" --dry-run' })

    const log = await run('mission-log')
    expect(log.text).not.toContain('product mr')
  })

  test('a non-MR command (e.g. reading an MR’s notes) is ignored even though stdout mentions an MR url for this project', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    on('tool.call', () => ({
      result: { stdout: JSON.stringify([{ body: '見 https://example.com/org/repo/-/merge_requests/9' }]), stderr: '', interrupted: false },
    }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'glab api projects/:id/merge_requests/9/notes' })

    const log = await run('mission-log')
    expect(log.text).not.toContain('product mr')
  })

  test('cat of a spec that happens to mention an MR url for this project is ignored too', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoWithRemote(on)
    mockProcessRun(on, {})
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    on('tool.call', () => ({
      result: { stdout: '上一棒的 MR：https://example.com/org/repo/-/merge_requests/9', stderr: '', interrupted: false },
    }))
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    await $.tool.call({ tool: 'Bash', command: 'cat docs/spec.md' })

    const log = await run('mission-log')
    expect(log.text).not.toContain('product mr')
  })
})

describe('issue-note detection', () => {
  const REPO_WITH_REMOTE = { root: '/repo', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' }

  function setupIssueNoteRoot(on: On) {
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.repo', () => ({ value: REPO_WITH_REMOTE }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
  }

  test('issue-note.sh with the mission’s own issue iid and this project’s short name records an issue-note product event', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupIssueNoteRoot(on)
    mockProcessRun(on, {})
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.tool.call({ tool: 'Bash', command: 'issue-note.sh repo 473 "已依保存期限清除"' })

    const log = await run('mission-log')
    expect(log.text).toContain('product issue-note')
  })

  test('issue-note.sh against a different issue number does not count for this mission', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupIssueNoteRoot(on)
    mockProcessRun(on, {})
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.tool.call({ tool: 'Bash', command: 'issue-note.sh repo 999 "留言"' })

    const log = await run('mission-log')
    expect(log.text).not.toContain('product issue-note')
  })

  test('issue-note.sh against another project does not count, even with the right issue number', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupIssueNoteRoot(on)
    mockProcessRun(on, {})
    const run = (command: string, args = '') =>
      $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.tool.call({ tool: 'Bash', command: 'issue-note.sh other-project 473 "留言"' })

    const log = await run('mission-log')
    expect(log.text).not.toContain('product issue-note')
  })
})

describe('acceptance refresh', () => {
  const REPO = { root: '/repo', remote: null, internal: true, name: 'repo' }
  const ACCEPTANCE_PATH = '/repo/.claude/specs/acceptance-473.md'
  const CHECKLIST_1AC = ['# 驗收清單：#473 x', '<!-- acceptance:meta {"key":"473"} -->', '', '- 整體回歸：未跑', '', '### AC-1 x', '- 結果：待驗', ''].join('\n')
  const SPEC_PATH = '/repo/.claude/specs/spec-473-foo.md'
  const CHECKLIST_WITH_SPEC = [
    '# 驗收清單：#473 x',
    '<!-- acceptance:meta {"key":"473","spec":"spec-473-foo.md","specMtime":"2026-10-01T00:00:00.000Z"} -->',
    '',
    '- 整體回歸：未跑',
    '',
    '### AC-1 x',
    '- 結果：待驗',
    '',
  ].join('\n')
  const WORKTREE_PATH = '/repo/.claude/worktrees/feat_x'
  const CHECKLIST_OVERALL_PASSED = (sha: string) =>
    [
      '# 驗收清單：#473 x',
      '<!-- acceptance:meta {"key":"473"} -->',
      '',
      `- 整體回歸：通過｜2026-10-24T03:00:00.000Z｜${sha}｜1 條 journey`,
      '',
      '### AC-1 x',
      '- 結果：通過｜測試 x（紅→綠）',
      '',
    ].join('\n')

  // 不用 setupRoot：這組測試要精確控制 fs.exists／fs.read 依路徑回應（像 MR detection
  // 那組測試一樣），用 setupRoot 內建「什麼路徑都回同一段文字」的 stub 會讓驗收清單
  // 誤判成已存在（見 maybeRefreshAcceptance 的 resolveAcceptancePath）。
  function setupRepoRoot(on: On) {
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
  }

  test('a Write to the mission’s acceptance file refreshes the summary, shown as a detail on to-acceptance', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_1AC : '# x\n\n## Agent skills\n' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.tool.call({ tool: 'Write', file_path: ACCEPTANCE_PATH, content: CHECKLIST_1AC })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui.unmount()
  })

  test('an Edit to the mission’s acceptance file also refreshes the summary', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_1AC : '# x\n\n## Agent skills\n' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.tool.call({ tool: 'Edit', file_path: ACCEPTANCE_PATH, old_string: '待驗', new_string: '待驗' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui.unmount()
  })

  test('a Write to an unrelated file never touches $.fs — no refresh attempted', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    let fsCalled = false
    on('fs.exists', () => {
      fsCalled = true
      return { value: true }
    })
    on('fs.read', () => {
      fsCalled = true
      return { value: CHECKLIST_1AC }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    // mission-start 本身的 setup 檢查也會打 $.fs；等它跑完才開始量這次 Write 有沒有碰 fs。
    fsCalled = false
    await $.tool.call({ tool: 'Write', file_path: '/repo/.claude/specs/spec-473-foo.md', content: 'irrelevant' })

    expect(fsCalled).toBe(false)
  })

  test('session.repo() is null (outside a repo, or a plain folder): maybeRefreshAcceptance does nothing, no $.fs calls', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.repo', () => ({ value: null }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    let fsCalled = false
    on('fs.exists', () => {
      fsCalled = true
      return { value: true }
    })
    on('fs.read', () => {
      fsCalled = true
      return { value: '# x\n\n## Agent skills\n' }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    // mission-start 本身的 setup 檢查（pstack-models.md）也會打一次 fs.exists，跟
    // repo 是不是 null 無關；等它跑完才開始量 maybeRefreshAcceptance 有沒有碰 fs。
    fsCalled = false
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(fsCalled).toBe(false)
  })

  test('a worktree-bound mission (binding is the worktree path, not session:<id>) resolves against session.repo().root — the main checkout — not session.root() the worktree', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const WORKTREE_ROOT = '/repo/.claude/worktrees/feat_x'
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: WORKTREE_ROOT }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_1AC : '# x\n\n## Agent skills\n' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    // bindingFor：session.root() 跟 session.repo().root 不一樣，綁的是 session.root()
    // 本身（worktree 路徑），不是 session:<id>——這就是「worktree-bound」的任務。
    await $.session.start({ cwd: WORKTREE_ROOT, surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    // ACCEPTANCE_PATH 是用 REPO.root（/repo，主 checkout）拼出來的；能刷出內容
    // 就證明真的是拿 session.repo().root 查路徑，不是 session.root()（worktree 路徑）。
    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui.unmount()
  })

  test('turn.complete also refreshes the summary (covers a background Bash writing the checklist)', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_1AC : '# x\n\n## Agent skills\n' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui.unmount()
  })

  test('a non-# mission caches the scanned filename; a second refresh reuses it instead of re-listing .claude/specs', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRepoRoot(on)
    let listCalls = 0
    on('fs.list', () => {
      listCalls += 1
      return { value: [{ name: 'acceptance-tour-notes.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] }
    })
    let missionName = ''
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => {
      if (e.path === '/repo/.claude/specs/acceptance-tour-notes.md') {
        return {
          value: `# 驗收清單\n<!-- acceptance:meta {"key":"tour-notes","mission":"${missionName}"} -->\n\n- 整體回歸：未跑\n\n### AC-1 x\n- 結果：待驗\n`,
        }
      }
      return { value: '# x\n\n## Agent skills\n' }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'tour-notes')
    // 任務名有日期前綴，先讀 store 拿到真正的名字，驗收清單的 meta.mission 才對得上。
    missionName = Object.keys((storeMap.get('missions') as Record<string, unknown>) ?? {})[0] ?? ''

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(listCalls).toBe(1)

    await $.turn.complete({ answer: '', durationMs: 2, isAborted: false, turnId: 't2', reason: 'answer' })
    // 第二次刷新：快取的檔名還對得上，不用再掃一次目錄。
    expect(listCalls).toBe(1)

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui.unmount()
  })

  test('a non-# mission rescans when the cached file’s meta.mission no longer matches (e.g. someone reassigned it)', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRepoRoot(on)
    let listCalls = 0
    on('fs.list', () => {
      listCalls += 1
      return { value: [{ name: 'acceptance-tour-notes.md', kind: 'file', size: 0, mtimeMs: 0, isLink: false }] }
    })
    let missionName = ''
    // metaMission 是這份清單檔案目前宣告自己屬於哪個任務；一開始跟真正的任務名一樣，
    // 後面改成別的名字，模擬「這份清單被改成配到別的任務」的情境。
    let metaMission = ''
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => {
      if (e.path === '/repo/.claude/specs/acceptance-tour-notes.md') {
        return {
          value: `# 驗收清單\n<!-- acceptance:meta {"key":"tour-notes","mission":"${metaMission}"} -->\n\n- 整體回歸：未跑\n\n### AC-1 x\n- 結果：待驗\n`,
        }
      }
      return { value: '# x\n\n## Agent skills\n' }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'tour-notes')
    missionName = Object.keys((storeMap.get('missions') as Record<string, unknown>) ?? {})[0] ?? ''
    metaMission = missionName

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(listCalls).toBe(1)

    const ui1 = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui1.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui1.unmount()

    // 這份清單被改成配到別的任務（meta.mission 換了）；快取的檔名讀起來已經不是這個
    // 任務自己的那份，tryCachedPath 要判定快取失效，退回重新掃一次目錄。
    metaMission = '別的任務'
    await $.turn.complete({ answer: '', durationMs: 2, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(listCalls).toBe(2)

    // 重掃一次還是同一份檔案、但 meta.mission 還是對不上，一樣配不到——變成 exists:false。
    const ui2 = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui2.find({ type: 'Text', text: /to-acceptance（/ })).toBeUndefined()
    await ui2.unmount()
  })

  test('two consecutive refreshes against an unchanged checklist write to the store only once (readAt alone is not a real change)', async ($, on) => {
    mock.clock(on)
    // 不能疊兩次 on('store.set', ...)（第二次會被引擎拒絕：registered twice），
    // 用同一個 handler、單一個計數器量「某個時間點之後」又寫了幾次。
    const storeMap = new Map<string, unknown>()
    let setCalls = 0
    on('store.get', (_, e) => ({ value: storeMap.get(e.key) }))
    on('store.set', (_, e) => {
      setCalls += 1
      storeMap.set(e.key, e.value)
      return { value: undefined }
    })
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_1AC : '# x\n\n## Agent skills\n' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    // mission-start、第一次 turn.complete 都寫過 store 了；清掉之前累積的次數，
    // 只量「內容沒變的第二次 turn.complete」真的有沒有再寫一次。
    setCalls = 0
    await $.turn.complete({ answer: '', durationMs: 2, isAborted: false, turnId: 't2', reason: 'answer' })

    expect(setCalls).toBe(0)
  })

  test('running /to-acceptance also refreshes the summary', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_1AC : '# x\n\n## Agent skills\n' }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.skill.prompt({ skill: 'x:to-acceptance', text: '/to-acceptance' })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80, 13) })
    expect(await ui.find({ type: 'Text', text: 'to-acceptance（1 條）' })).toBeDefined()
    await ui.unmount()
  })

  test('a missing checklist file is exists:false with no error logged', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', (_, e) => ({ value: e.path !== ACCEPTANCE_PATH }))
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(logs.filter(text => text.includes('驗收清單'))).toHaveLength(0)
    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    expect(await ui.find({ type: 'Text', text: /to-acceptance（/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a read failure (file exists but $.fs.read throws) is logged once, not every turn, and does not stop other steps from running', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => {
      if (e.path === ACCEPTANCE_PATH) throw new Error('EACCES')
      return { value: '# x\n\n## Agent skills\n' }
    })
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.skill.prompt({ skill: 'x:grill-with-docs', text: 'hi' })
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    expect(logs.filter(text => text.includes('讀取驗收清單失敗'))).toHaveLength(1)
    // 這一步失敗不會波及別的事：之前（turn.complete 之前）記下的事件還是讀得到，
    // 證明讀檔失敗被 maybeRefreshAcceptance 自己接住，沒有把整個 turn.complete hook 炸掉。
    const log = await run('mission-log')
    expect(log.text).toContain('skill')

    // 同一個錯誤持續發生（還是同一份檔案、還是讀不到）：再跑一次 turn.complete，
    // 不該再記一次一樣的訊息——不然權限問題一直沒修好，每個 turn 都會洗一次 log。
    await $.turn.complete({ answer: '', durationMs: 2, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(logs.filter(text => text.includes('讀取驗收清單失敗'))).toHaveLength(1)
  })

  test('a successful read clears lastReadError, so a later identical failure is logged again (not deduped forever)', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    // 第 1、3 次讀 ACCEPTANCE_PATH 成功（內容都一樣），第 2、4 次丟一樣的錯誤：
    // 驗證「中間成功過一次」會清掉 lastReadError，讓第 4 次的失敗被當成新的一次來記。
    let readCount = 0
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => {
      if (e.path !== ACCEPTANCE_PATH) return { value: '# x\n\n## Agent skills\n' }
      readCount += 1
      if (readCount === 2 || readCount === 4) throw new Error('EACCES')
      return { value: CHECKLIST_1AC }
    })
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }) // 讀 1：成功
    await $.turn.complete({ answer: '', durationMs: 2, isAborted: false, turnId: 't2', reason: 'answer' }) // 讀 2：失敗，記 log
    await $.turn.complete({ answer: '', durationMs: 3, isAborted: false, turnId: 't3', reason: 'answer' }) // 讀 3：成功，清掉 lastReadError
    await $.turn.complete({ answer: '', durationMs: 4, isAborted: false, turnId: 't4', reason: 'answer' }) // 讀 4：一樣的錯誤，但該算新的一次

    expect(logs.filter(text => text.includes('讀取驗收清單失敗'))).toHaveLength(2)
  })

  test('Write/Edit to the checklist path under a worktree’s own .claude/specs hints the wrong location instead of trying to refresh', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
    const logs: string[] = []
    on('ui.log', (_, e) => {
      logs.push(e.text)
      return { value: undefined }
    })
    let fsListCalled = false
    on('fs.list', () => {
      fsListCalled = true
      return { value: [] }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })
    const worktreeAcceptancePath = '/repo/.claude/worktrees/feat_x/.claude/specs/acceptance-tour-notes.md'

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'tour-notes')
    await $.tool.call({ tool: 'Write', file_path: worktreeAcceptancePath, content: 'x' })

    expect(logs.some(text => text.includes('worktree') && text.includes(worktreeAcceptancePath))).toBe(true)
    // 不該因此跑掃描——這份檔案不在主 checkout，掃也掃不到它，白白多一次 $.fs.list。
    expect(fsListCalled).toBe(false)
  })

  test('specStale：refresh 時順便查 meta.spec 的 mtime，比 meta.specMtime 晚就記 true', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_WITH_SPEC : '# x\n\n## Agent skills\n' }))
    on('fs.stat', (_, e) => {
      if (e.path === SPEC_PATH) return { value: { kind: 'file', size: 0, mtimeMs: Date.parse('2026-10-02T00:00:00.000Z'), isLink: false } }
      throw new Error('ENOENT')
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const missions = storeMap.get('missions') as Missions
    const m = Object.values(missions)[0]
    expect(m?.acceptance?.specStale).toBe(true)
  })

  test('specStale：spec mtime 沒變（同一秒內）就記 false', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_WITH_SPEC : '# x\n\n## Agent skills\n' }))
    on('fs.stat', (_, e) => {
      if (e.path === SPEC_PATH) return { value: { kind: 'file', size: 0, mtimeMs: Date.parse('2026-10-01T00:00:00.500Z'), isLink: false } }
      throw new Error('ENOENT')
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const missions = storeMap.get('missions') as Missions
    const m = Object.values(missions)[0]
    expect(m?.acceptance?.specStale).toBe(false)
  })

  test('overallStale：worktree 現在的 HEAD 跟整體回歸記的 sha 不一樣，就記 true', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: WORKTREE_PATH }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_OVERALL_PASSED('recorded-sha') : '# x\n\n## Agent skills\n' }))
    on('process.run', (_, e) => {
      if (e.argv.join(' ') === `git -C ${WORKTREE_PATH} rev-parse HEAD`) {
        return { value: { exitCode: 0, stdout: 'current-sha\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    // session.root() 跟 session.repo().root 不一樣 → binding 是 worktree 路徑本身，
    // mission.worktreePath 也要是這個 worktree 才會觸發 git 查詢——直接在 store 裡
    // 塞好 mission（跳過 mission-start 本身不會設 worktreePath 的流程）。
    await $.session.start({ cwd: WORKTREE_PATH, surface: null, isInteractive: false })
    await run('mission-start', '#473')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) storeMap.set('missions', { ...before, [name]: { ...m, worktreePath: WORKTREE_PATH } })

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const after = storeMap.get('missions') as Missions
    const mAfter = Object.values(after)[0]
    expect(mAfter?.acceptance?.overallStale).toBe(true)
    // sha 不一樣時 overall-regression 不算完成，整體回歸本身的 status 還是如實記錄「通過」。
    expect(mAfter?.acceptance?.overall?.status).toBe('通過')
  })

  test('overallStale：sha 一樣就記 false', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: WORKTREE_PATH }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_OVERALL_PASSED('same-sha') : '# x\n\n## Agent skills\n' }))
    on('process.run', (_, e) => {
      if (e.argv.join(' ') === `git -C ${WORKTREE_PATH} rev-parse HEAD`) {
        return { value: { exitCode: 0, stdout: 'same-sha\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: WORKTREE_PATH, surface: null, isInteractive: false })
    await run('mission-start', '#473')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) storeMap.set('missions', { ...before, [name]: { ...m, worktreePath: WORKTREE_PATH } })

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.acceptance?.overallStale).toBe(false)
  })

  // format.md 現在要求整體回歸記滿 40 字的完整 sha，但要容忍手改或舊清單留著縮寫版（≥7
  // 字元，git 短 sha 慣例的下限）：head 用 startsWith 比對，不要求字數對齊。
  test('overallStale：清單記的是縮短過的 short sha（≥7 字），head 用 startsWith 比對一樣就記 false', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: WORKTREE_PATH }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_OVERALL_PASSED('abc1234') : '# x\n\n## Agent skills\n' }))
    on('process.run', (_, e) => {
      if (e.argv.join(' ') === `git -C ${WORKTREE_PATH} rev-parse HEAD`) {
        return { value: { exitCode: 0, stdout: 'abc1234def5678900000000000000000000000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: WORKTREE_PATH, surface: null, isInteractive: false })
    await run('mission-start', '#473')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) storeMap.set('missions', { ...before, [name]: { ...m, worktreePath: WORKTREE_PATH } })

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.acceptance?.overallStale).toBe(false)
  })

  test('overallStale：清單記的 sha 尾端帶省略符號（手動截斷顯示），去掉之後一樣就記 false', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: WORKTREE_PATH }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_OVERALL_PASSED('abc1234…') : '# x\n\n## Agent skills\n' }))
    on('process.run', (_, e) => {
      if (e.argv.join(' ') === `git -C ${WORKTREE_PATH} rev-parse HEAD`) {
        return { value: { exitCode: 0, stdout: 'abc1234def5678900000000000000000000000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: WORKTREE_PATH, surface: null, isInteractive: false })
    await run('mission-start', '#473')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) storeMap.set('missions', { ...before, [name]: { ...m, worktreePath: WORKTREE_PATH } })

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.acceptance?.overallStale).toBe(false)
  })

  // computeOverallStale 只有任務記了 worktreePath 才會查 git；沒有 worktreePath（例如舊任務
  // 或還沒建 worktree）就直接相信清單記錄的「通過」，不會因為查不到而誤判過期。
  test('overallStale：mission 沒有 worktreePath 就不查 git，直接相信清單記錄（not stale）', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRepoRoot(on)
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_OVERALL_PASSED('recorded-sha') : '# x\n\n## Agent skills\n' }))
    let processRunCalled = false
    on('process.run', () => {
      processRunCalled = true
      return { value: { exitCode: 0, stdout: 'whatever\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', '#473')
    await $.tool.call({ tool: 'Write', file_path: ACCEPTANCE_PATH, content: CHECKLIST_OVERALL_PASSED('recorded-sha') })

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(80) })
    await ui.unmount()
    expect(processRunCalled).toBe(false)
  })

  // git rev-parse 本身失敗（exit code 非 0，例如 worktree 目錄被刪、detached 狀態異常）
  // 一樣要相信清單記錄，不貿然判定過期——跟查不到 commit 時不清空既有快照是同一個保守原則。
  test('overallStale：git rev-parse 失敗（非 0 exit code）就相信清單記錄（not stale）', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: WORKTREE_PATH }))
    on('session.repo', () => ({ value: REPO }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    on('tool.call', () => ({ result: {} }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', (_, e) => ({ value: e.path === ACCEPTANCE_PATH ? CHECKLIST_OVERALL_PASSED('recorded-sha') : '# x\n\n## Agent skills\n' }))
    on('process.run', (_, e) => {
      if (e.argv.join(' ') === `git -C ${WORKTREE_PATH} rev-parse HEAD`) {
        return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\n', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: WORKTREE_PATH, surface: null, isInteractive: false })
    await run('mission-start', '#473')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) storeMap.set('missions', { ...before, [name]: { ...m, worktreePath: WORKTREE_PATH } })

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.acceptance?.overallStale).toBe(false)
  })
})

describe('mission-review command', () => {
  const REPO_WITH_REMOTE = { root: '/repo', remote: 'git@example.com:org/repo.git', internal: true, name: 'org/repo' }
  const MR_PATH = 'projects/org%2Frepo/merge_requests/9'

  function setupReview(on: On) {
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('session.root', () => ({ value: '/repo' }))
    on('session.repo', () => ({ value: REPO_WITH_REMOTE }))
    on('session.id', () => ({ value: 'sess-1' }))
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    mock.env(on, { HOME: '/home/x' })
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '# x\n\n## Agent skills\n' }))
  }

  // 討論列表是分頁抓的（見 hooks/review-events.ts 的 fetchAllDiscussions），預設只回應
  // page=1，且回應陣列長度一定小於 100，讓迴圈在第一頁就停止；要測多頁的情境另外客製。
  function mockGlab(on: On, responses: { mr?: unknown; approvals?: unknown; discussions?: unknown; user?: unknown; exitCode?: number }) {
    on('process.run', (_, e) => {
      const joined = e.argv.join(' ')
      const json = (value: unknown) => ({ value: { exitCode: responses.exitCode ?? 0, stdout: JSON.stringify(value), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
      if (joined === `glab api ${MR_PATH}`) return json(responses.mr ?? { state: 'opened' })
      if (joined === `glab api ${MR_PATH}/approvals`) return json(responses.approvals ?? { approved_by: [] })
      if (joined === `glab api ${MR_PATH}/discussions?per_page=100&page=1`) return json(responses.discussions ?? [])
      if (joined === 'glab api user') return json(responses.user ?? { username: 'me' })
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
  }

  // 任務塞到審查階段，帶一筆 mr product 事件（iid=9）——直接操作 storeMap 比把九個節點
  // 的事件全部造一遍快得多，跟既有 acceptance／worktree 這類測試同一個做法。
  async function startAtReview(storeMap: Map<string, unknown>, run: (command: string, args?: string) => Promise<{ text?: string }>) {
    await run('mission-start', 'demo')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name === undefined || m === undefined) throw new Error('mission-start 沒有建立任務')
    storeMap.set('missions', {
      ...before,
      [name]: { ...m, stage: 3, events: [...m.events, { at: 1, kind: 'product', name: 'mr', missingSections: [], mrIid: '9' }], review: { round: 1, roundStartedAt: 0, discussions: [] } },
    })
    return name
  }

  test('refuses outside the review stage', async ($, on) => {
    mock.clock(on)
    mockStoreMap(on)
    setupReview(on)
    mockGlab(on, {})
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')

    const result = await run('mission-review')
    expect(result.text).toContain('還沒到審查階段')
  })

  test('refuses with no MR detected yet', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, {})
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name !== undefined && m !== undefined) storeMap.set('missions', { ...before, [name]: { ...m, stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [] } } })

    const result = await run('mission-review')
    expect(result.text).toContain('還沒偵測到 MR')
  })

  test('a successful sync (not merged) reports a summary and writes review state, without advancing the stage', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, { mr: { state: 'opened' }, approvals: { approved: false }, discussions: [] })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)

    const result = await run('mission-review')
    expect(result.text).toContain('opened')
    expect(result.text).toContain('未核准')

    const after = storeMap.get('missions') as Missions
    const mission = Object.values(after)[0]
    expect(mission?.stage).toBe(3)
    expect(mission?.review?.mrState).toBe('opened')
    expect(mission?.review?.lastSyncAt).toBeDefined()
  })

  test('classifies a feedback discussion from a reviewer, counted in the summary and setting sawFeedback', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, {
      discussions: [{ id: 'd1', notes: [{ id: 1, body: '這裡要補 null 檢查', author: { username: 'reviewer' } }] }],
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)

    const result = await run('mission-review')
    expect(result.text).toContain('1 則回饋討論')
    expect(result.text).toContain('1 則待回')

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.review?.sawFeedback).toBe(true)
  })

  test('once mrState is merged, auto-advances to the finish stage in the same command', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, { mr: { state: 'merged' } })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)

    const result = await run('mission-review')
    expect(result.text).toContain('merged')
    expect(result.text).toContain('已進入')

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.stage).toBe(4)
  })

  test('a glab failure (non-zero exit) reports an error and does not touch the stored mission', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, { exitCode: 1 })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)
    const before = storeMap.get('missions') as Missions

    const result = await run('mission-review')
    expect(result.text).toContain('同步失敗')

    const after = storeMap.get('missions') as Missions
    expect(after).toEqual(before)
  })

  test('approvals endpoint failing aborts the whole sync (does not silently write approved:false)', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    on('process.run', (_, e) => {
      const joined = e.argv.join(' ')
      if (joined === `glab api ${MR_PATH}/approvals`) return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}`) return { value: { exitCode: 0, stdout: JSON.stringify({ state: 'opened' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)
    const before = storeMap.get('missions') as Missions

    const result = await run('mission-review')
    expect(result.text).toContain('同步失敗')
    expect(result.text).toContain('核准')

    const after = storeMap.get('missions') as Missions
    expect(after).toEqual(before)
  })

  test('`glab api user` failing (selfUsername not cached yet) aborts the whole sync rather than classifying with selfUsername undefined', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    on('process.run', (_, e) => {
      const joined = e.argv.join(' ')
      if (joined === 'glab api user') return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}`) return { value: { exitCode: 0, stdout: JSON.stringify({ state: 'opened' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/approvals`) return { value: { exitCode: 0, stdout: JSON.stringify({ approved_by: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)
    const before = storeMap.get('missions') as Missions

    const result = await run('mission-review')
    expect(result.text).toContain('同步失敗')
    expect(result.text).toContain('帳號')

    const after = storeMap.get('missions') as Missions
    expect(after).toEqual(before)
  })

  test('a cached selfUsername skips the `glab api user` call entirely — its failure does not abort the sync', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    let userCalled = false
    on('process.run', (_, e) => {
      const joined = e.argv.join(' ')
      if (joined === 'glab api user') {
        userCalled = true
        return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      if (joined === `glab api ${MR_PATH}`) return { value: { exitCode: 0, stdout: JSON.stringify({ state: 'opened' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/approvals`) return { value: { exitCode: 0, stdout: JSON.stringify({ approved_by: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const name = await startAtReview(storeMap, run)
    const before = storeMap.get('missions') as Missions
    storeMap.set('missions', { ...before, [name]: { ...before[name]!, review: { round: 1, roundStartedAt: 0, discussions: [], selfUsername: 'me' } } })

    const result = await run('mission-review')
    expect(result.text).toContain('opened')
    expect(userCalled).toBe(false)
  })

  test('discussions pagination: a full first page (100 items) continues to a second page, totalling both', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, notes: [{ id: i, body: 'x', author: { username: 'reviewer' } }] }))
    const page2 = [{ id: 'd100', notes: [{ id: 100, body: 'y', author: { username: 'reviewer' } }] }]
    on('process.run', (_, e) => {
      const joined = e.argv.join(' ')
      if (joined === `glab api ${MR_PATH}`) return { value: { exitCode: 0, stdout: JSON.stringify({ state: 'opened' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/approvals`) return { value: { exitCode: 0, stdout: JSON.stringify({ approved_by: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/discussions?per_page=100&page=1`) return { value: { exitCode: 0, stdout: JSON.stringify(page1), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/discussions?per_page=100&page=2`) return { value: { exitCode: 0, stdout: JSON.stringify(page2), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === 'glab api user') return { value: { exitCode: 0, stdout: JSON.stringify({ username: 'me' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)

    const result = await run('mission-review')
    expect(result.text).toContain('101 則回饋討論')
  })

  test('MR closed (not merged): the reply text suggests /mission-finish <名稱> --force', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, { mr: { state: 'closed' } })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const name = await startAtReview(storeMap, run)

    const result = await run('mission-review')
    expect(result.text).toContain('closed')
    expect(result.text).toContain(`/mission-finish ${name} --force`)

    const after = storeMap.get('missions') as Missions
    expect(after[name]?.review?.mrState).toBe('closed')
    // closed 不是 merged：不自動推進階段。
    expect(after[name]?.stage).toBe(3)
  })

  test('/mission-next is refused in the review stage until a sync records mrState merged', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, {})
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReview(storeMap, run)

    const result = await run('mission-next')
    expect(result.text).toContain('/mission-review')

    const after = storeMap.get('missions') as Missions
    expect(Object.values(after)[0]?.stage).toBe(3)
  })

  test('a local discussion reply (glab api POST) marks that discussion as last-by-self without waiting for a sync', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    on('process.run', () => ({ value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('tool.call', () => ({ result: { stdout: '{}', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const name = await startAtReview(storeMap, run)
    const before = storeMap.get('missions') as Missions
    storeMap.set('missions', {
      ...before,
      [name]: { ...before[name]!, review: { round: 1, roundStartedAt: 0, discussions: [{ id: 'd1', isFeedback: true, resolved: false, lastBySelf: false }] } },
    })

    await $.tool.call({ tool: 'Bash', command: `glab api --method POST "projects/org%2Frepo/merge_requests/9/discussions/d1/notes" -f body="done"` })

    const after = storeMap.get('missions') as Missions
    expect(after[name]?.review?.discussions.find(d => d.id === 'd1')?.lastBySelf).toBe(true)
  })

  test('posting an MR-level comment (mr-note.sh) does not mark any discussion as replied', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    on('process.run', () => ({ value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const name = await startAtReview(storeMap, run)
    const before = storeMap.get('missions') as Missions
    storeMap.set('missions', {
      ...before,
      [name]: { ...before[name]!, review: { round: 1, roundStartedAt: 0, discussions: [{ id: 'd1', isFeedback: true, resolved: false, lastBySelf: false }] } },
    })

    await $.tool.call({ tool: 'Bash', command: `mr-note.sh org/repo 9 --body "已修正"` })

    const after = storeMap.get('missions') as Missions
    expect(after[name]?.review?.discussions.find(d => d.id === 'd1')?.lastBySelf).toBe(false)
  })

  // 真實案例：舊任務的 mr product 事件記錄在 mrIid 欄位加進來之前，完全沒有這個欄位，
  // 但開 MR 當時的 stdout 早就把網址收進了 assets（見 register.tsx 的 Bash hook「資產記錄」）。
  async function startAtReviewLegacy(storeMap: Map<string, unknown>, run: (command: string, args?: string) => Promise<{ text?: string }>, mrUrl: string) {
    await run('mission-start', 'demo')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name === undefined || m === undefined) throw new Error('mission-start 沒有建立任務')
    storeMap.set('missions', {
      ...before,
      [name]: {
        ...m,
        stage: 3,
        review: undefined,
        events: [...m.events, { at: 1, kind: 'product', name: 'mr', missingSections: [], missingAcs: [] }],
        assets: [{ url: mrUrl, label: '!9', description: 'MR', source: 'tool', at: 2 }],
      },
    })
    return name
  }

  test('legacy mission: stage 3, no review state, mr event has no mrIid, MR only in assets — /mission-review still finds it, creates review at round 1', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, { mr: { state: 'opened' }, approvals: { approved: false }, discussions: [] })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const name = await startAtReviewLegacy(storeMap, run, 'https://example.com/org/repo/-/merge_requests/9')

    const before = storeMap.get('missions') as Missions
    expect(before[name]?.review).toBeUndefined()

    const result = await run('mission-review')
    expect(result.text).not.toContain('還沒偵測到 MR')
    expect(result.text).toContain('opened')

    const after = storeMap.get('missions') as Missions
    expect(after[name]?.review?.round).toBe(1)
    expect(after[name]?.review?.mrState).toBe('opened')
  })

  test('legacy mission: an MR asset belonging to another project is not mistaken for this mission’s MR', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    mockGlab(on, {})
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReviewLegacy(storeMap, run, 'https://example.com/some/other-project/-/merge_requests/9')

    const result = await run('mission-review')
    expect(result.text).toContain('還沒偵測到 MR')
  })

  test('legacy mission: before the first sync, reverify/push-fix stay hidden and maybeRefreshReviewHeads is a no-op (review still undefined)', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    const processRunCalls: string[] = []
    on('process.run', (_, e) => {
      processRunCalls.push(e.argv.join(' '))
      return { value: { exitCode: 0, stdout: 'deadbeef\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('tool.call', () => ({ result: {} }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await startAtReviewLegacy(storeMap, run, 'https://example.com/org/repo/-/merge_requests/9')

    // turn.complete 會跑 maybeRefreshReviewHeads；review 還是 undefined，應該整個跳過，
    // 不去打 git——還沒同步過，連要比對的基準都沒有。
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    // maybeUpdateBranchCommits（既有功能）一樣會在 turn.complete 查 git，所以不是「完全沒打
    // process.run」，而是 maybeRefreshReviewHeads 自己那組 git rev-parse 完全沒出現。
    expect(processRunCalls.some(c => c.startsWith('git rev-parse'))).toBe(false)

    const after = storeMap.get('missions') as Missions
    const [name] = Object.entries(after)[0] ?? []
    expect(name !== undefined ? after[name]?.review : undefined).toBeUndefined()
  })

  test('mission already past the review stage (finish, with leftover review data): maybeRefreshReviewHeads does not touch git', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    const processRunCalls: string[] = []
    on('process.run', (_, e) => {
      processRunCalls.push(e.argv.join(' '))
      return { value: { exitCode: 0, stdout: 'deadbeef\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('tool.call', () => ({ result: {} }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')
    const before = storeMap.get('missions') as Missions
    const [name, m] = Object.entries(before)[0] ?? []
    if (name === undefined || m === undefined) throw new Error('mission-start 沒有建立任務')
    storeMap.set('missions', { ...before, [name]: { ...m, stage: 4, review: { round: 2, roundStartedAt: 0, lastSyncAt: 1, discussions: [] } } })

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(processRunCalls.some(c => c.startsWith('git rev-parse'))).toBe(false)
  })

  test('legacy mission: after the first sync, maybeRefreshReviewHeads starts tracking local/remote heads', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupReview(on)
    const processRunCalls: string[] = []
    on('process.run', (_, e) => {
      const joined = e.argv.join(' ')
      processRunCalls.push(joined)
      if (joined === `glab api ${MR_PATH}`) return { value: { exitCode: 0, stdout: JSON.stringify({ state: 'opened' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/approvals`) return { value: { exitCode: 0, stdout: JSON.stringify({ approved_by: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === `glab api ${MR_PATH}/discussions?per_page=100&page=1`) return { value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === 'glab api user') return { value: { exitCode: 0, stdout: JSON.stringify({ username: 'me' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === 'git rev-parse HEAD') return { value: { exitCode: 0, stdout: 'abc\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (joined === 'git rev-parse @{u}') return { value: { exitCode: 0, stdout: 'abc\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('turn.complete', (_, e) => ({ text: e.answer }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const name = await startAtReviewLegacy(storeMap, run, 'https://example.com/org/repo/-/merge_requests/9')
    await run('mission-review')
    processRunCalls.length = 0

    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(processRunCalls.some(c => c.startsWith('git rev-parse'))).toBe(true)

    const after = storeMap.get('missions') as Missions
    expect(after[name]?.review?.localHead).toBe('abc')
    expect(after[name]?.review?.remoteHead).toBe('abc')
  })
})

describe('/mission-cost', () => {
  test('records the current session on start and sends it to the measuring script', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRoot(on)
    let sent: { argv: readonly string[]; stdin?: string } | undefined
    on('process.run', (_, e) => {
      if (e.argv[0] === 'python3') {
        sent = { argv: e.argv, stdin: e.init?.stdin }
        const stdout = JSON.stringify({ used: ['sess-1'], missing: [], ambiguous: [], stages: [] })
        return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'alpha')
    expect(Object.values(storeMap.get('missions') as Missions)[0]?.sessionIds).toEqual(['sess-1'])

    const result = await run('mission-cost', '--sessions 932280e8')
    expect(sent?.argv[2]).toMatch(/scripts\/mission-cost\.py$/)
    expect(JSON.parse(sent?.stdin ?? '{}').sessions).toEqual(['sess-1', '932280e8'])
    expect(result.text).toContain('各階段 token 用量')
  })

  test('mission-finish measures the cost before the record is cleared', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRoot(on)
    on('process.run', () => {
      const stdout = JSON.stringify({ used: ['sess-1'], missing: [], ambiguous: [], stages: [] })
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'alpha')
    const result = await run('mission-finish', '0101-alpha --force')
    expect(result.text).toContain('各階段 token 用量')
    expect(Object.keys(storeMap.get('missions') as Missions)).toEqual([])
    // /cleanup 提示要墊在整段回覆最後一行，不能被夾在成本報告前面。
    const lastLine = (result.text ?? '').trim().split('\n').at(-1)
    expect(lastLine).toContain('/cleanup')
  })

  test('a failing measurement does not block mission-finish, and /cleanup still ends up as the last line', async ($, on) => {
    mock.clock(on)
    const storeMap = mockStoreMap(on)
    setupRoot(on)
    on('process.run', () => {
      throw new Error('python3 not found')
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'alpha')
    const result = await run('mission-finish', '0101-alpha --force')
    expect(result.text).toContain('成本沒量到')
    expect(Object.keys(storeMap.get('missions') as Missions)).toEqual([])
    const lastLine = (result.text ?? '').trim().split('\n').at(-1)
    expect(lastLine).toContain('/cleanup')
  })

  test('mission-finish that refuses does not print a cost report, nor the /cleanup hint', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRoot(on)
    on('process.run', () => {
      const stdout = JSON.stringify({ used: ['sess-1'], missing: [], ambiguous: [], stages: [] })
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'alpha')
    const result = await run('mission-finish')
    expect(result.text).not.toContain('token 用量')
    expect(result.text).not.toContain('/cleanup')
  })
})

describe('help ("?" button and /mission-help)', () => {
  test('a "?" help button is drawn on the tabs row at steps-only (80) and two-box (120) widths, but not in narrow mode (40)', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRoot(on)
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')

    for (const bodyColumns of [80, 120]) {
      const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(bodyColumns) })
      expect(await ui.find({ type: 'Button', key: 'help' })).toBeDefined()
      await ui.unmount()
    }

    const narrowUi = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(40) })
    expect(await narrowUi.find({ type: 'Button', key: 'help' })).toBeUndefined()
    await narrowUi.unmount()
  })

  test('pressing the "?" button opens docs/guide.html via $.process.run, under this plugin\'s own root', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const setRoot = setupRootNoToolCall(on)
    const opened: (readonly string[])[] = []
    on('process.run', (_, e) => {
      opened.push(e.argv)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    setRoot('/repo')
    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    await run('mission-start', 'demo')

    const ui = await $.ui.mount({ plugin: 'mission-band', surface: 'terminal', component: 'AbovePrompt', props: ABOVE_PROMPT(100) })
    await ui.press({ key: 'help' })
    await ui.unmount()

    expect(opened).toHaveLength(1)
    expect(opened[0]?.[0]).toBe('open')
    expect(opened[0]?.[1]).toMatch(/\/docs\/guide\.html$/)
  })

  test('/mission-help opens the guide and reports success without the path', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRoot(on)
    let opened = false
    on('process.run', (_, e) => {
      opened = e.argv[0] === 'open' && (e.argv[1]?.endsWith('/docs/guide.html') ?? false)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const result = await run('mission-help')
    expect(opened).toBe(true)
    expect(result.text).not.toContain('docs/guide.html')
  })

  test('/mission-help falls back to the file path when opening fails (a non-zero exit or a thrown error)', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    setupRoot(on)
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'no such app', isStdoutTruncated: false, isStderrTruncated: false } }))
    const run = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: PRESENTATION })

    await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
    const result = await run('mission-help')
    expect(result.text).toMatch(/\/docs\/guide\.html$/)
  })
})
