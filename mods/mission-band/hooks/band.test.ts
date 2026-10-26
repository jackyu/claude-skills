import { describe, expect, test } from 'claude-code/testing'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { Mission, MissionFlow } from '../types'
import { bandPlan } from './band'

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    name: 'demo',
    flow: 'new-feature',
    binding: '/repo',
    createdAt: 0,
    stage: 0,
    skips: {},
    events: [],
    ...overrides,
  }
}

describe('bandPlan width', () => {
  test('narrow (<60 columns) squeezes to a single line', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 40, 10, undefined)
    expect(plan.mode).toBe('narrow')
    if (plan.mode !== 'narrow') throw new Error('unreachable')
    expect(plan.line).toContain('demo')
  })

  test('narrowLine is returned whole, not sliced by bodyColumns (CJK-safe truncation happens in register.tsx)', () => {
    // 故意把寬度設得比整行字數還窄，確認 model 層沒有用字元數裁切。
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 10, 10, undefined)
    if (plan.mode !== 'narrow') throw new Error('unreachable')
    expect(plan.line).toBe('demo｜開始 0/7｜請輸入 /grill-with-docs，把需求問到能拿來驗收')
  })

  test('59 columns is still narrow, 60 is steps-only', () => {
    expect(bandPlan(mission(), NEW_FEATURE_FLOW, 59, 10, undefined).mode).toBe('narrow')
    expect(bandPlan(mission(), NEW_FEATURE_FLOW, 60, 10, undefined).mode).toBe('steps-only')
  })

  test('99 columns is steps-only, 100 is two-box', () => {
    expect(bandPlan(mission(), NEW_FEATURE_FLOW, 99, 10, undefined).mode).toBe('steps-only')
    expect(bandPlan(mission(), NEW_FEATURE_FLOW, 100, 10, undefined).mode).toBe('two-box')
  })
})

describe('bandPlan height budget', () => {
  // 固定佔掉的 5 行：tabs 1、框線上下 2、標題 1、下一步 1。框內最多 6 列，
  // 但還是要先扣掉那 5 行——maxRows 不夠扣的時候，不管寬度多少都退回單行摘要。
  test('total rendered rows (tabs + border×2 + title + inner + next) never exceeds min(13, maxRows), for maxRows 3..15', () => {
    // demo 任務的「開始」階段固定 7 個節點，maxRows 夠大時仍會被截（見下面
    // 「still truncates」那條），這條只驗證預算公式本身不會算超過。
    for (let maxRows = 3; maxRows <= 15; maxRows += 1) {
      const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 120, maxRows, undefined)
      const budget = Math.min(13, maxRows)
      if (plan.mode === 'narrow') {
        expect(1).toBeLessThanOrEqual(budget)
        continue
      }
      const innerRows = plan.mode === 'two-box' ? Math.max(plan.steps.length, plan.assets.length) : plan.steps.length
      const total = 1 /* tabs */ + 2 /* border */ + 1 /* title */ + innerRows + 1 /* next */
      expect(total).toBeLessThanOrEqual(budget)
    }
  })

  // 7 個節點沒超過 MAX_INNER_ROWS（7）本身不會被截，但 maxRows=10 時還要扣掉固定的 5 行，
  // maxInnerRows 只剩 5，塞不下全部 7 個，所以還是會截成 4 筆 + 「另有 3 列」。
  test('maxRows=10 (the default) still truncates: 7 nodes do not fit in 5 inner rows', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toHaveLength(5)
    expect(plan.steps.at(-1)).toEqual({ key: 'more', segments: [{ text: '另有 3 列', dim: true }] })
  })

  test('maxRows=7 only has room for 1 inner row plus a "another N" row', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 80, 7, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps.at(-1)).toEqual({ key: 'more', segments: [{ text: '另有 6 列', dim: true }] })
  })

  test('maxRows=5 cannot fit even 1 inner row, so it falls back to the narrow single line regardless of width', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 120, 5, undefined)
    expect(plan.mode).toBe('narrow')
  })

  test('more than 6 rows in a box get cut to 5 plus a count of the rest, at the default maxRows=10', () => {
    const assets = Array.from({ length: 8 }, (_, i) => ({
      url: `https://a/${i}`,
      label: `l${i}`,
      description: '',
      source: 'manual' as const,
      at: 0,
    }))
    const plan = bandPlan(mission({ assets }), NEW_FEATURE_FLOW, 120, 10, undefined)
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    expect(plan.assets).toHaveLength(5)
    expect(plan.assets.at(-1)).toEqual({ key: 'more', segments: [{ text: '另有 4 列', dim: true }] })
  })
})

describe('bandPlan tabs (three states)', () => {
  test('completed stages are green ✓, the current stage is bold ●, future stages are dim ○', () => {
    const plan = bandPlan(mission({ stage: 1 }), NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs).toEqual({
      key: 'tabs',
      segments: [
        { text: 'demo', bold: true },
        { text: '｜', dim: true },
        { text: '✓ 開始', color: 'success' },
        { text: '● 實作', bold: true },
        { text: '○ 驗收', dim: true },
        { text: '○ 審查', dim: true },
        { text: '○ 收尾', dim: true },
      ],
    })
  })
})

describe('bandPlan title', () => {
  test('tabs row leads with "<project> > <mission name>" when a project name is given', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 80, 10, 'rsc-frontend')
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments[0]).toEqual({ text: 'rsc-frontend > demo', bold: true })
    expect(plan.tabs.segments[1]).toEqual({ text: '｜', dim: true })
  })

  test('tabs row falls back to just the mission name without a project name', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments[0]).toEqual({ text: 'demo', bold: true })
  })

  test('two-box tabs row also carries the title (same row, just a wider band)', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 120, 10, 'rsc-frontend')
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    expect(plan.tabs.segments[0]).toEqual({ text: 'rsc-frontend > demo', bold: true })
  })

  test('narrow line leads with "<project> > <mission name>" when a project name is given', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 10, 10, 'rsc-frontend')
    if (plan.mode !== 'narrow') throw new Error('unreachable')
    expect(plan.line.startsWith('rsc-frontend > demo｜')).toBe(true)
  })

  test('narrow line falls back to the mission name alone without a project name', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 10, 10, undefined)
    if (plan.mode !== 'narrow') throw new Error('unreachable')
    expect(plan.line.startsWith('demo｜')).toBe(true)
  })
})

describe('bandPlan steps', () => {
  test('step rows carry the right symbol (fixed width 2, for column alignment), color and skip reason for each status', () => {
    const m = mission({
      skips: { prototype: '沒有設計決定' },
      events: [{ at: 1, kind: 'skill', name: 'x:grill-with-docs' }],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')

    // 「開始」階段有 7 個節點，maxRows=10 時只放得下 4 筆＋「另有 N 列」（見
    // 「bandPlan height budget」那組測試），to-acceptance／to-tickets／create-worktree 會被截進去，
    // 這裡改成逐筆找 key 比對，不假設全部 7 筆都同時看得到。
    expect(plan.steps.find(r => r.key === 'grill-with-docs')).toEqual({
      key: 'grill-with-docs',
      segments: [
        { text: '▶', color: 'warning', width: 2 },
        { text: 'grill-with-docs', color: 'warning' },
      ],
    })
    expect(plan.steps.find(r => r.key === 'approach')).toEqual({
      key: 'approach',
      segments: [
        { text: '○', dim: true, width: 2 },
        { text: 'approach', dim: true },
      ],
    })
    expect(plan.steps.find(r => r.key === 'prototype')).toEqual({
      key: 'prototype',
      segments: [
        { text: '✗', color: 'error', width: 2 },
        { text: 'prototype（沒有設計決定）', color: 'error' },
      ],
    })
    expect(plan.steps.find(r => r.key === 'to-spec')).toEqual({
      key: 'to-spec',
      segments: [
        { text: '○', dim: true, width: 2 },
        { text: 'to-spec', dim: true },
      ],
    })
    expect(plan.steps.at(-1)).toEqual({ key: 'more', segments: [{ text: '另有 3 列', dim: true }] })
  })

  // grill 是從頭數起的 leading run，但只有它 1 個（prototype 已經 started、算 blocking，
  // 擋住 leading run 往下延伸），leading run 長度 1 不到收合門檻（≥2），所以不收合，
  // grill 自己還是一行——見「bandPlan leading-collapse overflow policy」那組測試。
  test('a done step (corroborated by a later one starting) renders green on its own row (leading run of 1 does not collapse)', () => {
    const m = mission({
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
      ],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps[0]).toEqual({
      key: 'grill-with-docs',
      segments: [
        { text: '✓', color: 'success', width: 2 },
        { text: 'grill-with-docs', color: 'success' },
      ],
    })
  })

  test('a stage with no nodes shows the placeholder row', () => {
    // 現行 flow 四個階段都有節點了，這條只剩測防呆：拿一個自己搭的空節點階段來確認。
    const emptyStageFlow: MissionFlow = { name: 'new-feature', stages: [{ id: 'start', label: '開始', nodes: [] }] }
    const plan = bandPlan(mission(), emptyStageFlow, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toEqual([{ key: 'placeholder', segments: [{ text: '（第二期補上）', dim: true }] }])
  })

  test('a long skip reason gets truncated with … so the row never wraps', () => {
    const m = mission({ skips: { prototype: '這是一個非常長非常長非常長非常長非常長非常長的跳過理由說明文字' } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    const prototypeRow = plan.steps.find(r => r.key === 'prototype')
    expect(prototypeRow?.segments[1]?.text.length).toBeLessThanOrEqual(38)
    expect(prototypeRow?.segments[1]?.text.endsWith('…')).toBe(true)
  })

  test('a 38-char label is kept whole, a 39-char one is cut to 37 chars plus …', () => {
    // label 組成是 `${id}（${reason}）`；id 固定是 prototype（9 字），加前後括號 2 字，
    // 剩下 27 字給 reason，湊出剛好 38／39 字的邊界。
    const at38 = mission({ skips: { prototype: 'a'.repeat(27) } })
    const plan38 = bandPlan(at38, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan38.mode !== 'steps-only') throw new Error('unreachable')
    const label38 = plan38.steps.find(r => r.key === 'prototype')?.segments[1]?.text
    expect(label38).toBe(`prototype（${'a'.repeat(27)}）`)
    expect(label38?.length).toBe(38)

    const at39 = mission({ skips: { prototype: 'a'.repeat(28) } })
    const plan39 = bandPlan(at39, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan39.mode !== 'steps-only') throw new Error('unreachable')
    const label39 = plan39.steps.find(r => r.key === 'prototype')?.segments[1]?.text
    expect(label39?.length).toBe(38)
    expect(label39?.endsWith('…')).toBe(true)
  })
})

describe('bandPlan leading-collapse overflow policy', () => {
  // 階段節點超過 maxInnerRows 時，先把從頭開始、連續不擋路的節點收成一行
  // 「✓ 前面 N 項已完成或略過」，收完還是太多才用舊的「另有 N 列」尾端截斷；只有真的
  // 塞不下才收合，收合只看從第 0 個節點開始、連續不中斷的不擋路節點，不是整段掃描。

  test('(a) 7 nodes, first 4 done/skip: collapses into "前面 4 項已完成或略過", the rest (incl. the current node) stays visible, no tail truncation needed', () => {
    const m = mission({ skips: { 'grill-with-docs': 'a', approach: 'd', prototype: 'b', 'to-spec': 'c' } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toEqual([
      { key: 'collapsed', segments: [{ text: '✓', color: 'success', width: 2 }, { text: '前面 4 項已完成或略過', color: 'success' }] },
      { key: 'to-acceptance', segments: [{ text: '○', dim: true, width: 2 }, { text: 'to-acceptance', dim: true }] },
      { key: 'to-tickets', segments: [{ text: '○', dim: true, width: 2 }, { text: 'to-tickets', dim: true }] },
      { key: 'create-worktree', segments: [{ text: '○', dim: true, width: 2 }, { text: 'create-worktree', dim: true }] },
    ])
  })

  test('(b) 7 nodes, none done/skip: no leading run to collapse, falls back to the existing tail truncation', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps.some(r => r.key === 'collapsed')).toBe(false)
    expect(plan.steps).toHaveLength(5)
    expect(plan.steps.at(-1)).toEqual({ key: 'more', segments: [{ text: '另有 3 列', dim: true }] })
  })

  test('(c) everything fits within maxInnerRows: nothing collapsed, even with leading done/skip nodes', () => {
    // 真實 flow 的「開始」階段 6 個節點放不進 maxInnerRows（最多 5），搭一個 3 節點的
    // 假階段才能驗到「塞得下就全部顯示、不收合」這條規則本身。
    const smallFlow: MissionFlow = {
      name: 'new-feature',
      stages: [{ id: 'start', label: '開始', nodes: [{ id: 'a', hint: '' }, { id: 'b', hint: '' }, { id: 'c', hint: '' }] }],
    }
    const m = mission({ skips: { a: '跳過 a', b: '跳過 b' } })
    const plan = bandPlan(m, smallFlow, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps.map(r => r.key)).toEqual(['a', 'b', 'c'])
  })

  test('(d) a done/skip node that comes after a not-done node is not collapsed — only a leading run (from index 0) counts', () => {
    // 只跳過 to-spec（index 2），grill／prototype（index 0、1）都還沒碰——leading run
    // 從 index 0 數起就斷掉（grill 不是 done／skip），所以整段都不該收合，照舊尾端截斷。
    const m = mission({ skips: { 'to-spec': '理由' } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps.some(r => r.key === 'collapsed')).toBe(false)
    expect(plan.steps.find(r => r.key === 'to-spec')).toEqual({
      key: 'to-spec',
      segments: [
        { text: '✗', color: 'error', width: 2 },
        { text: 'to-spec（理由）', color: 'error' },
      ],
    })
  })

  // leading run 的判準是 isBlocking（done／skip／從沒開始過的 optional），不是單純
  // done／skip：grill／approach done、prototype／to-tickets 都是 optional 從沒碰過（不擋路）、
  // to-spec／to-acceptance 都 done，只有 create-worktree 還沒做完——leading run 一路
  // 數到 create-worktree 前面，長度 6，整段收合成一行，create-worktree（目前卡住的節點）
  // 一定還在，不會被尾端截斷吞掉。這是修掉的那個 bug：舊版只認 done／skip，prototype
  // 一碰到「not-started」就斷在 index 1，導致 create-worktree 被擠進「另有 2 列」。
  function doneButForCreateWorktree() {
    return mission({
      // to-acceptance 的 doneWhen 是 acceptance-file，靠事件標記不會變成 done（事件只會讓它
      // 變成 started），要靠 mission.acceptance.exists 才會真的 done。approach 自己要有事件
      // 才能靠後面的 prototype 真的開始了變成 done，不然它會卡在 not-started 擋住 leading run。
      acceptance: { exists: true, readAt: 0 },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'x:approach' },
        { at: 3, kind: 'skill', name: 'x:to-spec' },
      ],
    })
  }

  test('(e) leading run counts never-started optional nodes as non-blocking too, so create-worktree (the current node) is never swallowed — maxRows=10', () => {
    const plan = bandPlan(doneButForCreateWorktree(), NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toEqual([
      { key: 'collapsed', segments: [{ text: '✓', color: 'success', width: 2 }, { text: '前面 6 項已完成或略過', color: 'success' }] },
      { key: 'create-worktree', segments: [{ text: '○', dim: true, width: 2 }, { text: 'create-worktree', dim: true }] },
    ])
  })

  test('(f) same scenario at a smaller maxRows=8 (maxInnerRows=3): still collapses to 2 rows, create-worktree still visible', () => {
    const plan = bandPlan(doneButForCreateWorktree(), NEW_FEATURE_FLOW, 80, 8, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toEqual([
      { key: 'collapsed', segments: [{ text: '✓', color: 'success', width: 2 }, { text: '前面 6 項已完成或略過', color: 'success' }] },
      { key: 'create-worktree', segments: [{ text: '○', dim: true, width: 2 }, { text: 'create-worktree', dim: true }] },
    ])
  })

  test('(g) a leading run of exactly 1 does not meet the ≥2 collapse threshold, but the current (blocking) node still survives tail truncation', () => {
    // grill 跳過（leading run 第 1 個），prototype 已經 started（擋住 leading run，
    // 不收合）；塞不下時改走「保留目前節點」的尾端截斷，prototype 仍然留著。
    const m = mission({ skips: { 'grill-with-docs': '用口頭確認過' }, events: [{ at: 1, kind: 'read', name: 'playbook:prototype' }] })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps.some(r => r.key === 'collapsed')).toBe(false)
    expect(plan.steps.find(r => r.key === 'prototype')).toEqual({
      key: 'prototype',
      segments: [
        { text: '▶', color: 'warning', width: 2 },
        { text: 'prototype', color: 'warning' },
      ],
    })
  })

  test('(h) maxRows=6 (maxInnerRows=1): only room for the current node itself, no 另有 row at all', () => {
    const plan = bandPlan(doneButForCreateWorktree(), NEW_FEATURE_FLOW, 80, 6, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toEqual([{ key: 'create-worktree', segments: [{ text: '○', dim: true, width: 2 }, { text: 'create-worktree', dim: true }] }])
  })

  test('(i) when the collapsed summary row itself gets pushed out by truncation, the overflow row counts real nodes ("另有 N 項"), not working rows', () => {
    // 5 個真實節點：a/b/c 被收合成 1 行（代表 3 個）；預算只放得下 1 列（d，目前卡住的
    // 節點）＋ 1 列「另有」，collapsed 那一行本身也被擠掉——「另有」要把它代表的節點還原
    // 回來算：e（尾端被截掉的 1 個）＋ a/b/c（3 個）＝ 4，不是字面上的「2 列」
    // （collapsed 跟 e 兩個 working row）。
    const customFlow: MissionFlow = {
      name: 'new-feature',
      stages: [
        {
          id: 'start',
          label: '開始',
          nodes: [{ id: 'a', hint: '' }, { id: 'b', hint: '' }, { id: 'c', hint: '' }, { id: 'd', hint: '' }, { id: 'e', hint: '' }],
        },
      ],
    }
    const m = mission({ skips: { a: '跳過 a', b: '跳過 b', c: '跳過 c' } })
    const plan = bandPlan(m, customFlow, 80, 7, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toEqual([
      { key: 'd', segments: [{ text: '○', dim: true, width: 2 }, { text: 'd', dim: true }] },
      { key: 'more', segments: [{ text: '另有 4 項', dim: true }] },
    ])
  })
})

describe('bandPlan next-step row', () => {
  test('uses the softened wording once the last node is done-via-last, not corroborated', () => {
    const m = mission({
      skips: { 'to-acceptance': '測試情境不管驗收清單', 'create-worktree': '測試情境不需要真的建' },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'x:approach' },
        { at: 3, kind: 'read', name: 'playbook:prototype' },
        { at: 4, kind: 'skill', name: 'x:to-spec' },
      ],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.next).toEqual({ key: 'next', segments: [{ text: '下一步：to-spec 完成後，/mission-next 進入「實作」' }] })
  })

  // MAX_STEP_TEXT_LENGTH（38）只套在 stepRow／assetRow 的 label，下一步這一行完全沒走
  // truncateText；to-acceptance 的提示比 38 字長，要原樣整句出現，不能被腰斬。
  test('the next-step row is not clipped by the 38-char step text limit — to-acceptance’s longer hint shows in full', () => {
    const m = mission({ skips: { 'grill-with-docs': 'a', approach: 'd', prototype: 'b', 'to-spec': 'c' } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.next).toEqual({
      key: 'next',
      segments: [{ text: '下一步：輸入 /to-acceptance 產生驗收清單；舊任務不需要就 /mission-skip to-acceptance <理由>' }],
    })
  })
})

describe('bandPlan step detail', () => {
  test('a doneWhen node with commits shows the commit count in parentheses', () => {
    const m = mission({
      stage: 1,
      events: [{ at: 1, kind: 'skill', name: 'x:implement' }],
      branchCommits: [{ hash: 'a', at: 2 }, { hash: 'b', at: 3 }, { hash: 'c', at: 4 }],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps[0]).toEqual({
      key: 'implement',
      segments: [
        { text: '✓', color: 'success', width: 2 },
        { text: 'implement（3 commits）', color: 'success' },
      ],
    })
  })

  test('code-review shows both tracks in the label, within the 38-char step text limit', () => {
    const bothRan = mission({
      stage: 1,
      events: [
        { at: 1, kind: 'skill', name: 'x:cr' },
        { at: 2, kind: 'agent', name: 'codex:codex-rescue' },
      ],
    })
    const plan = bandPlan(bothRan, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    const label = plan.steps.find(r => r.key === 'code-review')?.segments[1]?.text
    expect(label).toBe('code-review（Claude ✓ · Codex ✓）')
    expect(label?.length).toBeLessThanOrEqual(38)

    const codexSkipped = mission({
      stage: 1,
      skips: { 'code-review:codex': '不需要第二意見' },
      events: [{ at: 1, kind: 'skill', name: 'x:cr' }],
    })
    const skippedPlan = bandPlan(codexSkipped, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (skippedPlan.mode !== 'steps-only') throw new Error('unreachable')
    const skippedLabel = skippedPlan.steps.find(r => r.key === 'code-review')?.segments[1]?.text
    expect(skippedLabel).toBe('code-review（Claude ✓ · Codex 已跳過）')
    expect(skippedLabel?.length).toBeLessThanOrEqual(38)
  })

  test('an open-mr node with missing sections shows them after 缺', () => {
    const m = mission({
      stage: 3,
      events: [
        { at: 1, kind: 'skill', name: 'x:push' },
        { at: 2, kind: 'product', name: 'mr', missingSections: ['Merge Danger', 'Evidence'] },
      ],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps[0]).toEqual({
      key: 'open-mr',
      segments: [
        { text: '✓', color: 'success', width: 2 },
        { text: 'open-mr（缺 Merge Danger、Evidence）', color: 'success' },
      ],
    })
  })

  // reverify 自動跳過（skipWhen）沒有對應的 mission.skips 項目，原因要靠 state.detail
  // 顯示出來，跟使用者打 /mission-skip 的樣式（✗ 加原因）一致。
  test('reverify auto-skipped (no acceptance checklist) shows the ✗ symbol with its derived reason, via state.detail not mission.skips', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    const reverifyRow = plan.steps.find(row => row.key === 'reverify')
    expect(reverifyRow).toEqual({
      key: 'reverify',
      segments: [
        { text: '✗', color: 'error', width: 2 },
        { text: 'verify-acceptance/overall（沒有驗收清單，不用重驗）', color: 'error' },
      ],
    })
  })
})

describe('bandPlan tickets-changed warning', () => {
  test('shows a warning row once to-tickets ran again after entering the build stage', () => {
    const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 20, kind: 'skill', name: 'x:to-tickets' }] })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.warnings).toEqual([{ key: 'tickets-changed', segments: [{ text: '票數有變動，檢查 issue 描述要不要同步', color: 'warning' }] }])
  })

  test('a to-tickets run before entering the build stage does not warn', () => {
    const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 5, kind: 'skill', name: 'x:to-tickets' }] })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.warnings).toEqual([])
  })

  test('the warning row costs 1 row of budget: total height still never exceeds min(13, maxRows)', () => {
    const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 20, kind: 'skill', name: 'x:to-tickets' }] })
    for (let maxRows = 3; maxRows <= 15; maxRows += 1) {
      const plan = bandPlan(m, NEW_FEATURE_FLOW, 120, maxRows, undefined)
      const budget = Math.min(13, maxRows)
      if (plan.mode === 'narrow') {
        expect(1).toBeLessThanOrEqual(budget)
        continue
      }
      const innerRows = plan.mode === 'two-box' ? Math.max(plan.steps.length, plan.assets.length) : plan.steps.length
      const warningRows = plan.warnings.length
      const total = 1 /* tabs */ + warningRows + 2 /* border */ + 1 /* title */ + innerRows + 1 /* next */
      expect(total).toBeLessThanOrEqual(budget)
    }
  })

  test('maxRows=10 with the warning shown leaves room for 1 fewer inner row than without it', () => {
    // 真實 flow 節點數最多的是審查階段（7 個），剛好打平 MAX_INNER_ROWS（7），看不出差
    // 1 列的效果；自己搭一個 8 節點的 build 階段才能把截斷逼出來。
    const manyNodesFlow: MissionFlow = {
      name: 'new-feature',
      stages: [
        { id: 'start', label: '開始', nodes: [] },
        {
          id: 'build',
          label: '實作',
          nodes: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, hint: '' })),
        },
      ],
    }
    const withWarning = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 20, kind: 'skill', name: 'x:to-tickets' }] })
    const withoutWarning = mission({ stage: 1, stageEnteredAt: [0, 10] })
    const planWith = bandPlan(withWarning, manyNodesFlow, 80, 10, undefined)
    const planWithout = bandPlan(withoutWarning, manyNodesFlow, 80, 10, undefined)
    if (planWith.mode !== 'steps-only' || planWithout.mode !== 'steps-only') throw new Error('unreachable')
    expect(planWithout.steps).toHaveLength(5)
    expect(planWith.steps).toHaveLength(4)
  })
})

describe('bandPlan spec-stale warning', () => {
  test('mission.acceptance.specStale 為 true 時顯示黃色提示列', () => {
    const m = mission({ acceptance: { exists: true, specStale: true, readAt: 0 } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.warnings).toContainEqual({ key: 'spec-stale', segments: [{ text: '規格改過了，檢查驗收清單要不要更新', color: 'warning' }] })
  })

  test('specStale 是 false／沒有這個欄位：不顯示', () => {
    expect(bandPlan(mission(), NEW_FEATURE_FLOW, 80, 10, undefined)).toMatchObject({ warnings: [] })
    const falseCase = mission({ acceptance: { exists: true, specStale: false, readAt: 0 } })
    expect(bandPlan(falseCase, NEW_FEATURE_FLOW, 80, 10, undefined)).toMatchObject({ warnings: [] })
  })

  // 跟 ticketsChanged 不一樣：ticketsChanged 只在 build 階段才算，specStale 不管哪個階段
  // 都該提醒——這裡故意在 start 階段（stage 0）驗，不是 build。
  test('不限哪個階段：start 階段（stage 0）一樣會顯示', () => {
    const m = mission({ stage: 0, acceptance: { exists: true, specStale: true, readAt: 0 } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.warnings).toHaveLength(1)
  })

  test('narrow 模式下也會接在後面顯示（跟 ticketsChanged 的 ⚠ 字尾同一個機制）', () => {
    const m = mission({ acceptance: { exists: true, specStale: true, readAt: 0 } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 10, 10, undefined)
    if (plan.mode !== 'narrow') throw new Error('unreachable')
    expect(plan.line).toContain('｜⚠ 規格改過了，檢查驗收清單要不要更新')
  })

  test('跟 ticketsChanged 同時為 true：兩條警示列都顯示，高度預算依然不超過 min(10, maxRows)', () => {
    const m = mission({
      stage: 1,
      stageEnteredAt: [0, 10],
      events: [{ at: 20, kind: 'skill', name: 'x:to-tickets' }],
      acceptance: { exists: true, specStale: true, readAt: 0 },
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 120, 10, undefined)
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    expect(plan.warnings).toHaveLength(2)
    const innerRows = Math.max(plan.steps.length, plan.assets.length)
    const total = 1 /* tabs */ + plan.warnings.length + 2 /* border */ + 1 /* title */ + innerRows + 1 /* next */
    expect(total).toBeLessThanOrEqual(10)
  })
})

describe('bandPlan review stage (round label, sync time, round warning)', () => {
  test('round 1 shows the plain stage label, no round suffix', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments.some(s => s.text === '● 審查')).toBe(true)
  })

  test('round 2+ appends "（第 N 輪）" to the current-stage tab', () => {
    const m = mission({ stage: 3, review: { round: 2, roundStartedAt: 0, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments.some(s => s.text === '● 審查（第 2 輪）')).toBe(true)
  })

  test('shows "上次同步 X 前" as a dim suffix on the tabs row (not a warning row) only when both lastSyncAt and now are given', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, lastSyncAt: 1_000, discussions: [] } })
    const withNow = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined, 1_000 + 90 * 60 * 1000)
    if (withNow.mode !== 'steps-only') throw new Error('unreachable')
    expect(withNow.tabs.segments.at(-1)).toEqual({ text: '上次同步 1 小時前', dim: true })
    // 不再佔警示列的高度預算——這一行拿掉之後 warnings 應該是空的。
    expect(withNow.warnings).toEqual([])

    const withoutNow = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (withoutNow.mode !== 'steps-only') throw new Error('unreachable')
    expect(withoutNow.tabs.segments.some(s => s.text.startsWith('上次同步'))).toBe(false)
  })

  test('does not show the sync-time suffix outside the review stage even with leftover review data', () => {
    const m = mission({ stage: 4, review: { round: 1, roundStartedAt: 0, lastSyncAt: 1_000, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined, 2_000)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments.some(s => s.text.startsWith('上次同步'))).toBe(false)
    expect(plan.warnings).toEqual([])
  })

  // bug 修正：審查階段的 7 個節點（開 MR、凍結 spec、等審查、重驗、push、回覆、核准）原本
  // 因為「上次同步」佔掉一列警示，加上舊的 MAX_INNER_ROWS（6）天花板，怎麼樣都塞不下全部
  // 7 個，使用者又沒辦法在 band 裡滑動看剩下的。「上次同步」搬到 tabs 列、框內上限拉到 7
  // 之後，全部 7 個節點配合足夠的 maxRows 應該整個顯示，不再出現「另有」。
  test('a review-stage mission with all 7 nodes fits entirely (no 「另有」row) once maxRows is at least 13, with the sync time on the tabs row', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, lastSyncAt: 1_000, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 13, undefined, 1_000 + 90 * 60 * 1000)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toHaveLength(7)
    expect(plan.steps.some(row => row.key === 'more')).toBe(false)
    expect(plan.tabs.segments.at(-1)).toEqual({ text: '上次同步 1 小時前', dim: true })
  })

  // maxRows 還是不夠大時，7 個節點一樣要照既有的截斷規則處理，不會因為把「上次同步」
  // 搬走就變成「永遠塞得下」。
  test('with a small maxRows (9), the 7 review-stage nodes still truncate correctly with a 「另有」row', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 9, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.steps).toHaveLength(4)
    expect(plan.steps.at(-1)).toEqual({ key: 'more', segments: [{ text: '另有 4 列', dim: true }] })
  })

  // 加上後綴會讓 tabs 整行超過 bodyColumns 時整個不加——寧可少顯示一行資訊，也不要讓
  // 終端機把這一列硬擠成兩行（那樣反而打亂框內其他列的對齊與高度預算）。
  test('when adding the sync suffix would overflow bodyColumns (even though the tabs row itself still fits), the suffix is omitted rather than wrapped', () => {
    const m = mission({ stage: 3, review: { round: 2, roundStartedAt: 0, lastSyncAt: 1_000, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 60, 10, undefined, 1_000 + 90 * 60 * 1000)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments.some(s => s.text.startsWith('上次同步'))).toBe(false)
    // 確認真的是「量過之後因為太長才不加」，不是整個機制失效：tabs 本身（含輪次字樣）還在，
    // 後綴沒有被加上去，segment 數維持原本的 7（標題＋分隔線＋5 個階段）。
    expect(plan.tabs.segments).toHaveLength(7)
    expect(plan.tabs.segments.some(s => s.text === '● 審查（第 2 輪）')).toBe(true)
  })

  // register.tsx 在 tabs 列最右側加一顆「?」說明按鈕（plain + hotkey「h」，畫出來是固定
  // 4 格的「h: ?」），band.ts 不畫按鈕本身，但算「上次同步」後綴塞不塞得下要先幫它留位置。
  // 60 欄照舊算法剛好塞得下後綴（見上面 80 欄那條測試用的同一個 mission，60 欄下候選行寬
  // 剛好等於 60），扣掉按鈕的 4 格之後就塞不下，後綴要被丟掉。
  test('reserves room for the "?" help button before fitting the sync suffix — 60 columns fits the suffix alone but not suffix + button', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, lastSyncAt: 1_000, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 60, 10, undefined, 1_000 + 90 * 60 * 1000)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.tabs.segments.some(s => s.text.startsWith('上次同步'))).toBe(false)
  })

  test('round 3+ shows the "keep fixing the same fix" warning', () => {
    const m = mission({ stage: 3, review: { round: 3, roundStartedAt: 0, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.warnings).toContainEqual({ key: 'review-rounds', segments: [{ text: '連續幾輪在修上一輪的修法，先停下來檢查前提', color: 'warning' }] })
  })

  test('round 2 does not yet show the round warning (threshold is 3)', () => {
    const m = mission({ stage: 3, review: { round: 2, roundStartedAt: 0, discussions: [] } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')
    expect(plan.warnings.some(w => w.key === 'review-rounds')).toBe(false)
  })
})

describe('bandPlan verify stage sample (requested for the report)', () => {
  // 一個典型的驗收階段任務：verify-acceptance 還沒全過（5/8，1 未過、2 受阻）、regression 還欠 2 條、
  // overall 清單寫著通過但 commit 換了（過期）、blast-radius／interrogate 都還沒碰。
  test('完整的驗收階段 band 文字', () => {
    const m = mission({
      stage: 2,
      acceptance: {
        exists: true,
        counts: { total: 8, passed: 5, failed: 1, blocked: 2, pending: 0, regressionTodo: 2, regressionTotal: 3 },
        overall: { status: '通過', sha: 'abc123' },
        overallStale: true,
        readAt: 0,
      },
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 80, 10, undefined)
    if (plan.mode !== 'steps-only') throw new Error('unreachable')

    expect(plan.steps).toEqual([
      { key: 'acceptance-run', segments: [{ text: '○', dim: true, width: 2 }, { text: 'verify-acceptance（AC 5/8，1 未過，2 受阻）', dim: true }] },
      { key: 'regression-write', segments: [{ text: '○', dim: true, width: 2 }, { text: 'verify-acceptance/regression（2 條待寫）', dim: true }] },
      {
        key: 'overall-regression',
        segments: [{ text: '○', dim: true, width: 2 }, { text: 'verify-acceptance/overall（commit 變了）', dim: true }],
      },
      { key: 'blast-radius', segments: [{ text: '○', dim: true, width: 2 }, { text: 'blast-radius', dim: true }] },
      { key: 'interrogate', segments: [{ text: '○', dim: true, width: 2 }, { text: 'interrogate', dim: true }] },
    ])
    expect(plan.next).toEqual({ key: 'next', segments: [{ text: '下一步：輸入 /verify-acceptance 逐條驗收' }] })
  })
})

describe('bandPlan assets', () => {
  test('two-box shows a placeholder when there are none', () => {
    const plan = bandPlan(mission(), NEW_FEATURE_FLOW, 120, 10, undefined)
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    expect(plan.assets).toEqual([{ key: 'empty', segments: [{ text: '還沒有資產，用 /mission-link 加入', dim: true }] }])
  })

  test('each asset draws as a bullet, a clickable label, and a description computed from the url — not whatever is stored', () => {
    const m = mission({
      assets: [
        {
          url: 'https://git.example.com/a/b/-/issues/473',
          label: '#473',
          // 舊版寫入的資料格式，帶著專案短名；畫出來要脫離這個舊格式，不等重新收集。
          description: 'rsc-frontend issue',
          source: 'issue',
          at: 0,
        },
      ],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 120, 10, undefined)
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    expect(plan.assets).toEqual([
      {
        key: '#473',
        segments: [
          { text: '•', dim: true, width: 2 },
          { text: '#473', href: 'https://git.example.com/a/b/-/issues/473' },
          { text: 'issue', dim: true },
        ],
      },
    ])
  })

  test('驗收清單存在時也列在資產裡，說明是「驗收清單」', () => {
    const m = mission({ acceptance: { exists: true, resolvedPath: '/repo/.claude/specs/acceptance-473.md', readAt: 0 } })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 120, 10, undefined)
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    expect(plan.assets).toEqual([
      {
        key: 'acceptance-473.md',
        segments: [
          { text: '•', dim: true, width: 2 },
          { text: 'acceptance-473.md', href: 'file:///repo/.claude/specs/acceptance-473.md' },
          { text: '驗收清單', dim: true },
        ],
      },
    ])
  })

  test('a long label gets truncated with … (Link cannot wrap); the description is always a short constant word so it never truncates', () => {
    const m = mission({
      assets: [
        {
          url: 'https://git.example.com/a/b/-/issues/473',
          label: 'rsc-frontend-brokerage-service-development#473',
          description: '一段很長很長很長很長很長很長很長很長的資產說明文字內容',
          source: 'issue',
          at: 0,
        },
      ],
    })
    const plan = bandPlan(m, NEW_FEATURE_FLOW, 120, 10, undefined)
    if (plan.mode !== 'two-box') throw new Error('unreachable')
    const [bulletSegment, labelSegment, descriptionSegment] = plan.assets[0]?.segments ?? []
    expect(bulletSegment).toEqual({ text: '•', dim: true, width: 2 })
    expect(labelSegment?.text.length).toBeLessThanOrEqual(30)
    expect(labelSegment?.text.endsWith('…')).toBe(true)
    expect(descriptionSegment?.text).toBe('issue')
  })
})
