import { describe, expect, test } from 'claude-code/testing'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { Mission, Missions } from '../types'
import { missionAssets } from './assets'
import {
  appendMissionEvent,
  bindingFor,
  findBoundMission,
  finishMission,
  issueIidFromMissionName,
  nextStage,
  nextStepHint,
  nodeStates,
  resolveMissionName,
  restoreMission,
  routeEvent,
  skipNode,
  startMission,
  stageEnteredAt,
  stripPluginPrefix,
  ticketsChangedSinceBuild,
  withSessionId,
} from './model'
import { isBlocking, resolveNodeHint } from './node-states'
import { applyReviewSync } from './review-stage'

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

describe('stripPluginPrefix', () => {
  test('strips the plugin prefix off a namespaced name', () => {
    expect(stripPluginPrefix('mattpocock-skills:grill-with-docs')).toBe('grill-with-docs')
  })

  test('leaves a name with no prefix alone', () => {
    expect(stripPluginPrefix('grill-with-docs')).toBe('grill-with-docs')
  })
})

describe('nodeStates', () => {
  const nodes = NEW_FEATURE_FLOW.stages[0]?.nodes ?? []

  test('the start stage runs approach right after grill-with-docs, before prototype', () => {
    expect(nodes.map(n => n.id)).toEqual(['grill-with-docs', 'approach', 'prototype', 'to-spec', 'to-acceptance', 'to-tickets', 'create-worktree'])
  })

  test('approach is required (not optional) and matches the /approach skill', () => {
    const approachNode = nodes.find(n => n.id === 'approach')
    expect(approachNode?.optional).not.toBe(true)
    const m = mission({ events: [{ at: 1, kind: 'skill', name: 'x:approach' }] })
    const states = nodeStates(nodes, m)
    expect(states.find(s => s.node.id === 'approach')?.status).toBe('started')
  })

  test('a node with no matching event is not started', () => {
    const states = nodeStates(nodes, mission())
    expect(states.map(s => s.status)).toEqual([
      'not-started',
      'not-started',
      'not-started',
      'not-started',
      'not-started',
      'not-started',
      'not-started',
    ])
  })

  test('a node with a matching event, and nothing after it, is started', () => {
    const m = mission({ events: [{ at: 1, kind: 'skill', name: 'x:grill-with-docs' }] })
    const states = nodeStates(nodes, m)
    expect(states[0]?.status).toBe('started')
  })

  test('a node becomes done once a later node in the same stage starts', () => {
    const m = mission({
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
      ],
    })
    const states = nodeStates(nodes, m)
    expect(states[0]?.status).toBe('done')
    expect(states[2]?.status).toBe('started')
  })

  test('a skipped node is always skip, never done', () => {
    const m = mission({
      skips: { 'grill-with-docs': '不需要' },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'x:to-spec' },
      ],
    })
    const states = nodeStates(nodes, m)
    expect(states[0]?.status).toBe('skip')
  })

  test('the prototype node also matches a pstack read event', () => {
    const m = mission({ events: [{ at: 1, kind: 'read', name: 'playbook:prototype' }] })
    const states = nodeStates(nodes, m)
    expect(states[2]?.status).toBe('started')
  })

  test('the last node in a stage has nothing to wait for, so it is done once started; create-worktree (doneWhen) resolves via worktreePath, not an event', () => {
    const m = mission({
      worktreePath: '/repo/.claude/worktrees/feat_x',
      events: [{ at: 1, kind: 'skill', name: 'x:to-spec' }, { at: 2, kind: 'skill', name: 'x:to-tickets' }],
    })
    const states = nodeStates(nodes, m)
    // to-spec 靠「後面有節點真的開始了」（to-tickets 的事件）就算完成，不需要 to-acceptance
    // 自己也解決——hasLaterStart 本來就不要求「後面全部都解決」，只要有一個真的開始。
    expect(states[3]?.status).toBe('done')
    // to-acceptance 是必做節點，這個任務沒給它任何事件、也沒跳過，自己仍是
    // not-started；它不擋 to-spec 變成 done（見上面），但也不會被 to-tickets 的事件捲動。
    expect(states[4]?.status).toBe('not-started')
    expect(states[5]?.status).toBe('done')
    expect(states[6]?.status).toBe('done')
  })

  test('a required node becomes done when every later node was skipped explicitly', () => {
    // to-acceptance／to-tickets／create-worktree 都被明確 /mission-skip 掉，等於流程走過去了。
    const m = mission({
      skips: {
        'to-acceptance': '這個測試不管驗收清單',
        'to-tickets': '小票不用拆',
        'create-worktree': '測試環境已經有 worktree',
      },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
        { at: 3, kind: 'skill', name: 'x:to-spec' },
      ],
    })
    const states = nodeStates(nodes, m)
    expect(states[3]?.status).toBe('done')
  })

  test('a required node becomes done when the only untouched later node is optional (create-worktree resolved via worktreePath, not left dangling)', () => {
    const m = mission({
      skips: { 'to-acceptance': '這個測試不管驗收清單' },
      worktreePath: '/repo/.claude/worktrees/feat_x',
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
        { at: 3, kind: 'skill', name: 'x:to-spec' },
      ],
    })
    const states = nodeStates(nodes, m)
    expect(states[3]?.status).toBe('done')
    expect(states[5]?.status).toBe('not-started')
  })

  test('create-worktree (required, doneWhen, no start matcher) pending does not keep to-spec／to-tickets stuck at started', () => {
    // create-worktree 沒有任何 matchSkill／matchRead／matchAgentPrefix，永遠量不到「開始了」；
    // 它自己要不要擋 mission-next 由它自己的 status 決定（這裡還是 not-started，所以
    // nextStage 的 pending 清單會列到它），但不該連帶讓前面的 to-spec／to-tickets 卡在
    // ▶ 永遠變不成 ✓——那是完全不同的兩件事，見 isResolved 的 !hasStartMatcher 那條。
    const m = mission({
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
        { at: 3, kind: 'skill', name: 'x:to-spec' },
        { at: 4, kind: 'skill', name: 'x:to-tickets' },
      ],
    })
    const states = nodeStates(nodes, m)
    // to-spec 靠 to-tickets 的事件（hasLaterStart）變成 done，不需要 to-acceptance 自己解決。
    expect(states[3]?.status).toBe('done')
    // to-acceptance 沒給事件、沒跳過，自己仍是 not-started；不影響 to-spec／to-tickets。
    expect(states[4]?.status).toBe('not-started')
    expect(states[5]?.status).toBe('done')
    expect(states[6]?.status).toBe('not-started')
  })

  test('to-spec alone (to-tickets never touched) also shows done while create-worktree is still pending', () => {
    // to-acceptance 是必做節點，自己也要跳過才會像 to-tickets（optional）、create-worktree
    // （沒有 start matcher）一樣自動 resolve；不然它會卡住 to-spec 的 laterAllResolved。
    const m = mission({
      skips: { 'to-acceptance': '這個測試不管驗收清單' },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
        { at: 3, kind: 'skill', name: 'x:to-spec' },
      ],
    })
    const states = nodeStates(nodes, m)
    expect(states[3]?.status).toBe('done')
    expect(states[5]?.status).toBe('not-started')
    expect(states[6]?.status).toBe('not-started')
  })

  test('an event before the stage was entered does not count toward starting a node (stage time boundary on the event itself)', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 5, kind: 'skill', name: 'x:implement' }] })
    expect(nodeStates(buildNodes, m)[0]?.status).toBe('not-started')
  })

  test('matchSkill accepts an array of names (implement / implement-spec / tdd)', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    for (const name of ['implement', 'implement-spec', 'tdd']) {
      const m = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: `x:${name}` }] })
      const states = nodeStates(buildNodes, m)
      expect(states[0]?.status).not.toBe('not-started')
    }
  })

  test('the build stage runs no-comments right after implement, before code-review', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    expect(buildNodes.map(n => n.id)).toEqual(['implement', 'no-comments', 'code-review'])
  })

  test('no-comments is required (not optional) and matches the plugin-prefixed /pstack:no-comments skill', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    const noCommentsNode = buildNodes.find(n => n.id === 'no-comments')
    expect(noCommentsNode?.optional).not.toBe(true)
    const m = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'pstack:no-comments' }] })
    const states = nodeStates(buildNodes, m)
    expect(states.find(s => s.node.id === 'no-comments')?.status).toBe('started')
  })

  // no-comments 是 disable-model-invocation 的 pstack skill：AI 自己讀 SKILL.md 照做時（跟
  // blast-radius／interrogate／correct 一樣的路徑）只會留下 read 事件，不是 skill 事件，也要
  // 算「開始了」。
  test('no-comments also starts via reading the SKILL.md directly (matchRead), same as blast-radius/interrogate/correct', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    const m = mission({ stage: 1, events: [{ at: 1, kind: 'read', name: 'pstack:no-comments' }] })
    const states = nodeStates(buildNodes, m)
    expect(states.find(s => s.node.id === 'no-comments')?.status).toBe('started')
  })

  // 驗收階段現在沒有節點用 matchSkillPrefix 了（verify-app 被 acceptance-run／
  // regression-write／overall-regression 取代），機制本身還留著給別的 flow 用，自己搭一個
  // 節點測，不綁在目前的 NEW_FEATURE_FLOW 上。
  test('matchSkillPrefix matches verify-admin and verify-client alike, but not an unrelated skill', () => {
    // 後面補一個必做、沒碰過的節點，才不會因為「它是這個階段最後一個節點」被自動判定
    // done——這裡要測的是比對機制本身回不回「started」，不是最後一個節點的軟化規則。
    const verifyNodes = [
      { id: 'verify-app', matchSkillPrefix: 'verify-', hint: '' },
      { id: 'after', matchSkill: 'after-skill', hint: '' },
    ]
    const admin = mission({ events: [{ at: 1, kind: 'skill', name: 'x:verify-admin' }] })
    const client = mission({ events: [{ at: 1, kind: 'skill', name: 'x:verify-client' }] })
    const unrelated = mission({ events: [{ at: 1, kind: 'skill', name: 'x:retro' }] })
    expect(nodeStates(verifyNodes, admin)[0]?.status).toBe('started')
    expect(nodeStates(verifyNodes, client)[0]?.status).toBe('started')
    expect(nodeStates(verifyNodes, unrelated)[0]?.status).toBe('not-started')
  })

  describe('doneWhen commit (implement)', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []

    test('not done with no commits yet', () => {
      const m = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'x:implement' }] })
      expect(nodeStates(buildNodes, m)[0]?.status).toBe('started')
    })

    test('done once at least one branch commit lands at or after the stage was entered', () => {
      const m = mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [{ at: 1, kind: 'skill', name: 'x:implement' }],
        branchCommits: [{ hash: 'a', at: 12 }],
      })
      const state = nodeStates(buildNodes, m)[0]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('1 commits')
    })

    test('a commit before the build stage was entered does not count (stage time boundary)', () => {
      const m = mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [{ at: 11, kind: 'skill', name: 'x:implement' }],
        branchCommits: [{ hash: 'a', at: 5 }],
      })
      expect(nodeStates(buildNodes, m)[0]?.status).toBe('started')
    })
  })

  // code-review 併了兩條軌道（Claude、Codex）；至少一條跑過才算「開始」，兩條都跑過
  // （或 Codex 被跳過）才算「完成」——不再要求事後有 commit。它是 build 階段最後一個節點。
  describe('code-review tracks (Claude／Codex)', () => {
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    const codeReviewIndex = buildNodes.findIndex(node => node.id === 'code-review')

    test('neither track ran: not-started', () => {
      const m = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'x:implement' }] })
      const state = nodeStates(buildNodes, m)[codeReviewIndex]
      expect(state?.status).toBe('not-started')
    })

    test('Claude track only (via cr/code-review/fe-code-review skill): started', () => {
      for (const name of ['cr', 'code-review', 'fe-code-review']) {
        const m = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: `x:${name}` }] })
        expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('started')
      }
    })

    test('Codex track only, via the rescue skill (plugin-prefixed): started', () => {
      const m = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'codex:rescue' }] })
      expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('started')
    })

    test('Codex track only, via an Agent call whose subagent_type starts with codex:: started', () => {
      const m = mission({ stage: 1, events: [{ at: 1, kind: 'agent', name: 'codex:codex-rescue' }] })
      expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('started')
    })

    test('Codex track only, via running the Codex CLI in Bash (codex review / codex exec): started', () => {
      for (const name of ['codex review', 'codex exec']) {
        const m = mission({ stage: 1, events: [{ at: 1, kind: 'bash', name }] })
        expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('started')
      }
    })

    test('an unrelated agent or skill does not start the Codex track', () => {
      const unrelatedAgent = mission({ stage: 1, events: [{ at: 1, kind: 'agent', name: 'code-implementer' }] })
      const unrelatedSkill = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'x:retro' }] })
      expect(nodeStates(buildNodes, unrelatedAgent)[codeReviewIndex]?.status).toBe('not-started')
      expect(nodeStates(buildNodes, unrelatedSkill)[codeReviewIndex]?.status).toBe('not-started')
    })

    test('matchSkillExact requires the full name codex:rescue, not just any plugin whose skill happens to be called rescue', () => {
      const otherPluginRescue = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'some-other-plugin:rescue' }] })
      const bareRescue = mission({ stage: 1, events: [{ at: 1, kind: 'skill', name: 'rescue' }] })
      expect(nodeStates(buildNodes, otherPluginRescue)[codeReviewIndex]?.status).toBe('not-started')
      expect(nodeStates(buildNodes, bareRescue)[codeReviewIndex]?.status).toBe('not-started')
    })

    test('both tracks ran: done, with no commit required', () => {
      const m = mission({
        stage: 1,
        events: [
          { at: 1, kind: 'skill', name: 'x:cr' },
          { at: 2, kind: 'agent', name: 'codex:codex-rescue' },
        ],
      })
      const state = nodeStates(buildNodes, m)[codeReviewIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('Claude ✓ · Codex ✓')
    })

    test('Claude ran, Codex track explicitly skipped (code-review:codex): done', () => {
      const m = mission({
        stage: 1,
        skips: { 'code-review:codex': '不需要第二意見' },
        events: [{ at: 1, kind: 'skill', name: 'x:cr' }],
      })
      const state = nodeStates(buildNodes, m)[codeReviewIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('Claude ✓ · Codex 已跳過')
    })

    test('old mission data skipping the standalone codex-review node still counts as the Codex track skipped', () => {
      const m = mission({
        stage: 1,
        skips: { 'codex-review': '舊資料，沒有冒號' },
        events: [{ at: 1, kind: 'skill', name: 'x:cr' }],
      })
      const state = nodeStates(buildNodes, m)[codeReviewIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('Claude ✓ · Codex 已跳過')
    })

    test('an event before the stage was entered does not start the Claude track', () => {
      const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 5, kind: 'skill', name: 'x:cr' }] })
      expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('not-started')
    })

    test('a Codex event before the stage was entered does not start the Codex track either', () => {
      const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 5, kind: 'agent', name: 'codex:codex-rescue' }] })
      expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('not-started')
    })

    test('the whole node can still be skipped outright (code-review, no track)', () => {
      const m = mission({ stage: 1, skips: { 'code-review': '這次不用審' } })
      expect(nodeStates(buildNodes, m)[codeReviewIndex]?.status).toBe('skip')
    })

    test('Claude track explicitly skipped, Codex ran: done', () => {
      const m = mission({
        stage: 1,
        skips: { 'code-review:claude': '這次 Claude 不用審' },
        events: [{ at: 1, kind: 'agent', name: 'codex:codex-rescue' }],
      })
      const state = nodeStates(buildNodes, m)[codeReviewIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('Claude 已跳過 · Codex ✓')
    })

    test('both tracks skipped: resolves to done, not stuck at not-started (so /mission-next is not blocked)', () => {
      const m = mission({
        stage: 1,
        skips: { 'code-review:claude': '不用審', 'code-review:codex': '不用審' },
      })
      const state = nodeStates(buildNodes, m)[codeReviewIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('Claude 已跳過 · Codex 已跳過')
    })

    test('nextStepHint points at the missing track once code-review has started (implement and no-comments must be done first, or their own hint wins)', () => {
      const m = mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [
          { at: 11, kind: 'skill', name: 'x:implement' },
          { at: 11.6, kind: 'skill', name: 'x:no-comments' },
          { at: 12, kind: 'skill', name: 'x:cr' },
        ],
        branchCommits: [{ hash: 'a', at: 11.5 }],
      })
      expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe(
        '進行中：code-review　Codex 還沒審：叫 /codex:rescue 用 $fe-code-review 審這個分支、跳過爆炸半徑，或直接跑 codex exec -s read-only -C <worktree> \'$fe-code-review 審這個分支，跳過爆炸半徑\'（codex review 的 --base 不能跟 prompt 一起用）；不用就 /mission-skip code-review:codex <理由>',
      )
    })
  })

  describe('doneWhen mr (open-mr)', () => {
    const finishNodes = NEW_FEATURE_FLOW.stages[3]?.nodes ?? []

    test('not done with no mr product event', () => {
      const m = mission({ stage: 3, events: [{ at: 1, kind: 'skill', name: 'x:push' }] })
      expect(nodeStates(finishNodes, m)[0]?.status).toBe('started')
    })

    test('done once an mr product event lands, with no detail when nothing is missing', () => {
      const m = mission({
        stage: 3,
        events: [
          { at: 1, kind: 'skill', name: 'x:push' },
          { at: 2, kind: 'product', name: 'mr', missingSections: [] },
        ],
      })
      const state = nodeStates(finishNodes, m)[0]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBeUndefined()
    })

    test('shows the missing sections joined by 、 when some are missing', () => {
      const m = mission({
        stage: 3,
        events: [
          { at: 1, kind: 'skill', name: 'x:push' },
          { at: 2, kind: 'product', name: 'mr', missingSections: ['Merge Danger', 'Evidence'] },
        ],
      })
      const state = nodeStates(finishNodes, m)[0]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('缺 Merge Danger、Evidence')
    })
  })

  describe('doneWhen issue-note (freeze-spec)', () => {
    const finishNodes = NEW_FEATURE_FLOW.stages[3]?.nodes ?? []

    test('stays not-started with no start signal and no issue-note event', () => {
      const m = mission({ stage: 3 })
      expect(nodeStates(finishNodes, m)[1]?.status).toBe('not-started')
    })

    test('becomes done once an issue-note product event lands', () => {
      const m = mission({ stage: 3, events: [{ at: 1, kind: 'product', name: 'issue-note' }] })
      expect(nodeStates(finishNodes, m)[1]?.status).toBe('done')
    })
  })

  describe('doneWhen acceptance-file (to-acceptance)', () => {
    const toAcceptanceIndex = nodes.findIndex(node => node.id === 'to-acceptance')

    test('no mission.acceptance at all (舊資料／還沒刷新過): not-started', () => {
      expect(nodeStates(nodes, mission())[toAcceptanceIndex]?.status).toBe('not-started')
    })

    test('mission.acceptance.exists 是 false（還沒跑過 /to-acceptance）：not-started', () => {
      const m = mission({ acceptance: { exists: false, readAt: 0 } })
      expect(nodeStates(nodes, m)[toAcceptanceIndex]?.status).toBe('not-started')
    })

    test('mission.acceptance.exists 是 true：done，detail 附上 AC 條數', () => {
      const m = mission({ acceptance: { exists: true, counts: { total: 3, passed: 0, failed: 0, blocked: 0, pending: 3, regressionTodo: 0, regressionTotal: 0 }, readAt: 0 } })
      const state = nodeStates(nodes, m)[toAcceptanceIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBe('3 條')
    })

    test('exists 是 true 但沒有 counts（例如讀檔中途失敗留下的舊摘要）：done，但沒有 detail', () => {
      const m = mission({ acceptance: { exists: true, readAt: 0 } })
      const state = nodeStates(nodes, m)[toAcceptanceIndex]
      expect(state?.status).toBe('done')
      expect(state?.detail).toBeUndefined()
    })

    test('不看 enteredAt：即使驗收清單讀到的時間早於進入這個階段，照樣算完成（跟 doneWhen worktree 一樣）', () => {
      const m = mission({
        stageEnteredAt: [100],
        acceptance: { exists: true, readAt: 1 },
      })
      expect(nodeStates(nodes, m)[toAcceptanceIndex]?.status).toBe('done')
    })
  })

  describe('驗收階段三個節點（acceptance-run／regression-write／overall-regression）', () => {
    const verifyNodes = NEW_FEATURE_FLOW.stages[2]?.nodes ?? []
    const acceptanceRunIndex = verifyNodes.findIndex(node => node.id === 'acceptance-run')
    const regressionWriteIndex = verifyNodes.findIndex(node => node.id === 'regression-write')
    const overallRegressionIndex = verifyNodes.findIndex(node => node.id === 'overall-regression')

    test('沒有驗收清單：acceptance-run 是 not-started，顯示用的是中文標籤不是 id', () => {
      const m = mission({ stage: 2 })
      const states = nodeStates(verifyNodes, m)
      expect(states[acceptanceRunIndex]?.status).toBe('not-started')
      expect(states[acceptanceRunIndex]?.node.label).toBe('verify-acceptance')
    })

    test('regression-write 沒做完時（有 2 條待寫）detail 照樣透過 nodeStates 傳出來，不是只有做完才有', () => {
      const m = mission({
        stage: 2,
        acceptance: { exists: true, counts: { total: 3, passed: 3, failed: 0, blocked: 0, pending: 0, regressionTodo: 2, regressionTotal: 3 }, readAt: 0 },
      })
      const state = nodeStates(verifyNodes, m)[regressionWriteIndex]
      expect(state?.status).toBe('not-started')
      expect(state?.detail).toBe('2 條待寫')
    })

    test('舊任務在 skips 裡留著 verify-app（三個新節點取代前的 id）：照樣載入，不會因為多出來的舊 key 出錯，也不影響新節點自己的狀態', () => {
      const m = mission({
        stage: 2,
        skips: { 'verify-app': '舊資料，三個新節點取代前的 skip' },
        acceptance: { exists: true, counts: { total: 2, passed: 2, failed: 0, blocked: 0, pending: 0, regressionTodo: 0, regressionTotal: 0 }, readAt: 0 },
      })
      expect(() => nodeStates(verifyNodes, m)).not.toThrow()
      const states = nodeStates(verifyNodes, m)
      expect(states[acceptanceRunIndex]?.status).toBe('done')
      expect(states[regressionWriteIndex]?.status).toBe('done')
      expect(states[overallRegressionIndex]?.status).toBe('not-started')
    })
  })
})

describe('ticketsChangedSinceBuild', () => {
  test('false before entering the build stage', () => {
    const m = mission({ stage: 0, events: [{ at: 1, kind: 'skill', name: 'x:to-tickets' }] })
    expect(ticketsChangedSinceBuild(NEW_FEATURE_FLOW, m)).toBe(false)
  })

  test('true once to-tickets ran again at or after the build stage was entered', () => {
    const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 10, kind: 'skill', name: 'x:to-tickets' }] })
    expect(ticketsChangedSinceBuild(NEW_FEATURE_FLOW, m)).toBe(true)
  })

  test('false when the to-tickets event happened before the build stage was entered', () => {
    const m = mission({ stage: 1, stageEnteredAt: [0, 10], events: [{ at: 5, kind: 'skill', name: 'x:to-tickets' }] })
    expect(ticketsChangedSinceBuild(NEW_FEATURE_FLOW, m)).toBe(false)
  })

  test('false once the mission has moved on to verify or finish — the warning only matters while still in build', () => {
    const m = mission({ stage: 2, stageEnteredAt: [0, 10, 20], events: [{ at: 15, kind: 'skill', name: 'x:to-tickets' }] })
    expect(ticketsChangedSinceBuild(NEW_FEATURE_FLOW, m)).toBe(false)
  })
})

describe('stageEnteredAt', () => {
  test('falls back to createdAt when the mission has no stageEnteredAt at all (old data)', () => {
    const m = mission({ createdAt: 42 })
    expect(stageEnteredAt(m, 0)).toBe(42)
    expect(stageEnteredAt(m, 2)).toBe(42)
  })

  test('falls back to createdAt for an index missing from an existing array', () => {
    const m = mission({ createdAt: 1, stageEnteredAt: [1, 20] })
    expect(stageEnteredAt(m, 1)).toBe(20)
    expect(stageEnteredAt(m, 2)).toBe(1)
  })
})

describe('nextStepHint', () => {
  test('hints the first not-started node', () => {
    expect(nextStepHint(NEW_FEATURE_FLOW, mission())).toContain('/grill-with-docs')
  })

  // no-comments 卡在 implement 跟 code-review 之間；implement 靠 commit 做完（跟後面節點
  // 開不開始無關），下一步該提示 no-comments，不是跳過它直接講 code-review。
  test('once implement is done (commit landed), the next step points at no-comments', () => {
    const m = mission({
      stage: 1,
      events: [{ at: 1, kind: 'skill', name: 'x:implement' }],
      branchCommits: [{ hash: 'a', at: 2 }],
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/pstack:no-comments')
  })

  // approach 卡在 grill-with-docs 跟 prototype 之間，grill 做完、prototype 還沒碰時，
  // 下一步該提示 approach，不是跳過它直接講 prototype。
  test('once grill-with-docs is done (a later node started), the next step points at approach', () => {
    const m = mission({
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'read', name: 'playbook:prototype' },
      ],
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/approach')
  })

  // grill 只有自己的事件、沒有任何後面的節點真的開始，所以還是「進行中」而不是「完成」；
  // 這是最常見的情境——使用者剛打完 /grill-with-docs，接下來該提示的是 approach。
  test('grill-with-docs started but not yet corroborated (approach untouched): "進行中" names grill, hint points at approach', () => {
    const m = mission({ events: [{ at: 1, kind: 'skill', name: 'x:grill-with-docs' }] })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toBe(
      '進行中：grill-with-docs　輸入 /approach，檢查要用套件還是手寫、放哪裡、介面形狀、從哪裡開始；舊任務不需要就 /mission-skip approach <理由>',
    )
  })

  // regression-write 沒有驗收清單時直接算完成；進行中節點後面的「接下來」要跳過它，不能提示一個已經做完的步驟。
  test('the step after an in-progress node skips nodes that are already done', () => {
    const m = mission({ stage: 2, events: [{ at: 1, kind: 'skill', name: 'verify-acceptance' }] })
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe('進行中：verify-acceptance　沒有驗收清單的舊任務：/mission-skip overall-regression <理由>')
  })

  // 舊任務（還沒有驗收清單這一步的那些）第一次升級上來會卡在 to-acceptance，
  // 提示文字要讓使用者知道可以直接跳過，不是被迫一定要補一份驗收清單。
  test('to-acceptance hints both /to-acceptance and the /mission-skip fallback for older missions', () => {
    const m = mission({
      skips: { 'grill-with-docs': 'a', approach: 'd', prototype: 'b', 'to-spec': 'c' },
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/to-acceptance')
    expect(hint).toContain('/mission-skip to-acceptance <理由>')
  })

  // acceptance-run 的 hint 是函式，不是固定字串：有沒有驗收清單決定提示要不要先補跑
  // /to-acceptance，這條驗證 nextStepHint 真的會呼叫它、不是直接把函式本身接去顯示。
  test('acceptance-run 的 hint 看驗收清單存不存在而不同', () => {
    const withoutChecklist = mission({ stage: 2 })
    expect(nextStepHint(NEW_FEATURE_FLOW, withoutChecklist)).toBe('先跑 /to-acceptance，再跑 /verify-acceptance；舊任務不需要就 /mission-skip acceptance-run <理由>')

    const withChecklist = mission({ stage: 2, acceptance: { exists: true, readAt: 0 } })
    expect(nextStepHint(NEW_FEATURE_FLOW, withChecklist)).toBe('輸入 /verify-acceptance 逐條驗收')
  })

  // overall-regression 跟 acceptance-run 不一樣：沒有驗收清單一樣擋著（不能靠「沒資料
  // 就放過」跳過整體回歸本身），但提示要直接講怎麼跳過這個節點，不是像 acceptance-run
  // 那樣引導去跑 /to-acceptance。
  test('overall-regression 的 hint 看驗收清單存不存在而不同，但兩種情況都還是擋著', () => {
    const withoutChecklist = mission({ stage: 2, skips: { 'acceptance-run': 'x', 'regression-write': 'x' } })
    expect(nextStepHint(NEW_FEATURE_FLOW, withoutChecklist)).toBe('沒有驗收清單的舊任務：/mission-skip overall-regression <理由>')

    const withChecklist = mission({
      stage: 2,
      skips: { 'acceptance-run': 'x', 'regression-write': 'x' },
      acceptance: { exists: true, readAt: 0 },
    })
    expect(nextStepHint(NEW_FEATURE_FLOW, withChecklist)).toBe('/verify-acceptance 跑整體回歸（commit 後）')
  })

  test('says the stage is done once every required node is done or skipped, even with to-tickets untouched', () => {
    const m = mission({
      skips: { 'grill-with-docs': 'a', approach: 'f', prototype: 'b', 'to-spec': 'c', 'to-acceptance': 'e', 'create-worktree': 'd' },
    })
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toContain('/mission-next')
  })

  test('says everything is done at the last stage', () => {
    const m = mission({
      stage: 4,
      events: [{ at: 1, kind: 'skill', name: 'x:retro' }],
    })
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toContain('/mission-finish')
  })

  test('review stage: all nodes done but not merged yet, points at /mission-review instead of /mission-next', () => {
    const m = mission({
      stage: 3,
      events: [
        { at: 1, kind: 'product', name: 'mr', missingSections: [], mrIid: '5' },
        { at: 2, kind: 'product', name: 'issue-note' },
      ],
      review: { round: 1, roundStartedAt: 0, lastSyncAt: 0, discussions: [], sawFeedback: true, approved: true },
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/mission-review')
    expect(hint).not.toContain('/mission-next')
  })

  test('review stage: MR closed (not merged) always points at /mission-finish --force, regardless of node states', () => {
    const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [], mrState: 'closed' } })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/mission-finish demo --force')
    expect(hint).not.toContain('/mission-review')
    expect(hint).not.toContain('/mission-next')
  })

  test('review stage: once mrState is merged, the hint points at /mission-next into 「收尾」', () => {
    const m = mission({
      stage: 3,
      events: [
        { at: 1, kind: 'product', name: 'mr', missingSections: [], mrIid: '5' },
        { at: 2, kind: 'product', name: 'issue-note' },
      ],
      review: { round: 1, roundStartedAt: 0, discussions: [], sawFeedback: true, approved: true, mrState: 'merged' },
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/mission-next')
    expect(hint).toContain('收尾')
  })

  // acceptance-run 節點有 label（verify-acceptance），跟 id（acceptance-run）不一樣；「進行中」
  // 文字要顯示 label，不是 id——驗 displayName 真的被 nextStepHint 用到，不是還留著舊的
  // state.node.id。
  test('進行中的節點有 label 時，顯示 label 不是 id', () => {
    const m = mission({
      stage: 2,
      events: [{ at: 1, kind: 'skill', name: 'x:verify-acceptance' }],
      acceptance: {
        exists: true,
        counts: { total: 2, passed: 1, failed: 0, blocked: 0, pending: 1, regressionTotal: 0, regressionTodo: 0 },
        readAt: 0,
      },
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('進行中：verify-acceptance')
    expect(hint).not.toContain('進行中：acceptance-run')
  })

  test('while started, skips over an already-skipped node to find the real next hint', () => {
    const m = mission({
      skips: { approach: '這個測試不管 approach', prototype: '不需要設計決定' },
      events: [{ at: 1, kind: 'skill', name: 'x:grill-with-docs' }],
    })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('進行中：grill-with-docs')
    expect(hint).toContain('/to-spec')
  })

  test('softens the hint when the practical last node is done only because it is last, not corroborated', () => {
    // to-spec 做完才算這階段真的過關；to-acceptance 跳過（這個測試不管驗收清單）、
    // to-tickets 從沒碰過、create-worktree 跳過都不擋路，所以軟化語氣講的是 to-spec，
    // 不是陣列字面上的最後一個節點。
    const m = mission({
      skips: { 'to-acceptance': '測試情境不管驗收清單', 'create-worktree': '測試情境不需要真的建' },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'x:approach' },
        { at: 3, kind: 'read', name: 'playbook:prototype' },
        { at: 4, kind: 'skill', name: 'x:to-spec' },
      ],
    })
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe('to-spec 完成後，/mission-next 進入「實作」')
  })

  test('to-tickets rerun after to-spec is done still hints toward mission-next, not back at to-tickets', () => {
    const m = mission({
      skips: { 'to-acceptance': '測試情境不管驗收清單', 'create-worktree': '測試情境不需要真的建' },
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'x:approach' },
        { at: 3, kind: 'read', name: 'playbook:prototype' },
        { at: 4, kind: 'skill', name: 'x:to-spec' },
        { at: 5, kind: 'skill', name: 'x:to-tickets' },
      ],
    })
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe('to-tickets 完成後，/mission-next 進入「實作」')
  })

  test('create-worktree done via worktreePath becomes the actual last practical node, softening onto it instead of to-tickets', () => {
    const m = mission({
      skips: { 'to-acceptance': '測試情境不管驗收清單' },
      worktreePath: '/repo/.claude/worktrees/feat_x',
      events: [
        { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'x:approach' },
        { at: 3, kind: 'read', name: 'playbook:prototype' },
        { at: 4, kind: 'skill', name: 'x:to-spec' },
        { at: 5, kind: 'skill', name: 'x:to-tickets' },
      ],
    })
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe('create-worktree 完成後，/mission-next 進入「實作」')
  })
})

describe('issueIidFromMissionName', () => {
  test('reads the trailing #<n>', () => {
    expect(issueIidFromMissionName('1022-#473')).toBe('473')
  })

  test('is undefined for a mission named without an issue number', () => {
    expect(issueIidFromMissionName('1022-ctbc-layout')).toBeUndefined()
  })
})

describe('startMission seeding the own-issue asset', () => {
  test('seeds a bare #<n> asset when an issue url and iid are given', () => {
    const outcome = startMission({}, '1022-#473', '/repo', 0, 'https://git.example.com/a/b/-/issues/473', '473')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const demo = outcome.missions['1022-#473']
      expect(demo && missionAssets(demo)).toEqual([
        { url: 'https://git.example.com/a/b/-/issues/473', label: '#473', description: 'issue', source: 'issue', at: 0 },
      ])
    }
  })

  test('creates the mission with no assets when there is no issue url', () => {
    const outcome = startMission({}, 'demo', '/repo', 123)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(missionAssets(outcome.missions.demo!)).toEqual([])
  })

  test('seeds stageEnteredAt with the creation time for stage 0', () => {
    const outcome = startMission({}, 'demo', '/repo', 123)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.stageEnteredAt).toEqual([123])
  })
})

describe('routeEvent', () => {
  test('routes an event only to the mission bound to that root, not another', () => {
    const missions: Missions = {
      alpha: mission({ name: 'alpha', binding: '/repo-a' }),
      beta: mission({ name: 'beta', binding: '/repo-b' }),
    }
    const event = { at: 1, kind: 'skill' as const, name: 'x:grill-with-docs' }
    const next = routeEvent(missions, '/repo-a', event)

    expect(next.alpha?.events).toHaveLength(1)
    expect(next.beta?.events).toHaveLength(0)
  })

  test('does not record an event when no mission is bound to that root', () => {
    const missions: Missions = { alpha: mission({ name: 'alpha', binding: '/repo-a' }) }
    const event = { at: 1, kind: 'skill' as const, name: 'x:grill-with-docs' }
    const next = routeEvent(missions, '/repo-unbound', event)

    expect(next.alpha?.events).toHaveLength(0)
  })

  test('routes a product event (mr) carrying missingSections', () => {
    const missions: Missions = { alpha: mission({ name: 'alpha', binding: '/repo-a' }) }
    const event = { at: 1, kind: 'product' as const, name: 'mr', missingSections: ['Evidence'] }
    const next = routeEvent(missions, '/repo-a', event)
    expect(next.alpha?.events[0]).toEqual(event)
  })
})

describe('appendMissionEvent', () => {
  test('caps events at the 300 newest', () => {
    const events = Array.from({ length: 300 }, (_, i) => ({ at: i, kind: 'skill' as const, name: `e${i}` }))
    const full = mission({ events })
    const updated = appendMissionEvent(full, { at: 300, kind: 'skill', name: 'e300' })

    expect(updated.events).toHaveLength(300)
    expect(updated.events[0]?.name).toBe('e1')
    expect(updated.events.at(-1)?.name).toBe('e300')
  })
})

describe('startMission', () => {
  test('refuses a name that already exists', () => {
    const missions: Missions = { demo: mission() }
    expect(startMission(missions, 'demo', '/repo-2', 0).ok).toBe(false)
  })

  test('refuses a root already bound to another mission', () => {
    const missions: Missions = { demo: mission() }
    const outcome = startMission(missions, 'other', '/repo', 0)
    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('demo')
  })

  test('creates the mission otherwise', () => {
    const outcome = startMission({}, 'demo', '/repo', 123)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo).toMatchObject({ name: 'demo', binding: '/repo', stage: 0 })
  })
})

describe('skipNode', () => {
  test('refuses an unknown node id', () => {
    const missions: Missions = { demo: mission() }
    expect(skipNode(missions, '/repo', 'no-such-node', '理由', NEW_FEATURE_FLOW).ok).toBe(false)
  })

  test('records the skip and its reason', () => {
    const missions: Missions = { demo: mission() }
    const outcome = skipNode(missions, '/repo', 'prototype', '不需要設計決定', NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.skips.prototype).toBe('不需要設計決定')
  })

  test('skips only the Codex track of code-review, storing the colon-joined key', () => {
    const missions: Missions = { demo: mission({ stage: 1 }) }
    const outcome = skipNode(missions, '/repo', 'code-review:codex', '不需要第二意見', NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo?.skips['code-review:codex']).toBe('不需要第二意見')
      expect(outcome.missions.demo?.skips['code-review']).toBeUndefined()
    }
  })

  test('refuses an unknown track on a real node', () => {
    const missions: Missions = { demo: mission({ stage: 1 }) }
    expect(skipNode(missions, '/repo', 'code-review:nope', '理由', NEW_FEATURE_FLOW).ok).toBe(false)
  })

  test('refuses a track suffix on a node that has no tracks', () => {
    const missions: Missions = { demo: mission({ stage: 1 }) }
    expect(skipNode(missions, '/repo', 'implement:codex', '理由', NEW_FEATURE_FLOW).ok).toBe(false)
  })

  test('whole-node skip of code-review still works (no track suffix)', () => {
    const missions: Missions = { demo: mission({ stage: 1 }) }
    const outcome = skipNode(missions, '/repo', 'code-review', '這次不用審', NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.skips['code-review']).toBe('這次不用審')
  })

  test('accepts the label shown on the band and stores the skip under the node id', () => {
    const missions: Missions = { demo: mission({ stage: 2 }) }
    const outcome = skipNode(missions, '/repo', 'verify-acceptance', 'AC-6 受阻，使用者接受', NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo?.skips['acceptance-run']).toBe('AC-6 受阻，使用者接受')
      expect(outcome.missions.demo?.skips['verify-acceptance']).toBeUndefined()
    }
  })

  test('lists the node ids of the current stage when the input matches nothing', () => {
    const missions: Missions = { demo: mission({ stage: 2 }) }
    const outcome = skipNode(missions, '/repo', 'no-such-node', '理由', NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('acceptance-run')
    expect(outcome.text).toContain('blast-radius')
  })

  test('a legacy standalone-node skip id (codex-review, no colon) remaps to code-review:codex', () => {
    const missions: Missions = { demo: mission({ stage: 1 }) }
    const outcome = skipNode(missions, '/repo', 'codex-review', '舊指令，合併前的用法', NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo?.skips['code-review:codex']).toBe('舊指令，合併前的用法')
      expect(outcome.missions.demo?.skips['codex-review']).toBeUndefined()
    }
  })
})

describe('nextStage', () => {
  test('refuses while the stage has unfinished nodes, and lists them', () => {
    const missions: Missions = { demo: mission() }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toContain('grill-with-docs')
  })

  test('advances once every node is done or skipped', () => {
    const missions: Missions = {
      demo: mission({
        skips: { 'grill-with-docs': 'a', approach: 'f', prototype: 'b', 'to-spec': 'c', 'to-acceptance': 'e', 'create-worktree': 'd' },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.stage).toBe(1)
  })

  test('an optional node that was never started does not block advancing; create-worktree (required) must still be done', () => {
    // prototype 是 optional，從沒開始過也不用特別 /mission-skip；grill 用事件開始，
    // to-spec 開始了就算做完（因為 to-acceptance 被跳過、to-tickets 是 optional 沒碰過、
    // create-worktree 已經靠 worktreePath 做完，後面全部 resolve）；to-tickets 完全沒碰過不擋路；
    // approach 是必做節點，這裡用 /mission-skip 跳過，不靠事件。
    const missions: Missions = {
      demo: mission({
        skips: { approach: '這個測試不管 approach', 'to-acceptance': '這個測試不管驗收清單' },
        worktreePath: '/repo/.claude/worktrees/feat_x',
        events: [
          { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
          { at: 2, kind: 'skill', name: 'x:to-spec' },
        ],
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.stage).toBe(1)
  })

  test('refuses while create-worktree (required) is untouched, even if every other node is done or skipped', () => {
    const missions: Missions = {
      demo: mission({ skips: { 'grill-with-docs': 'a', approach: 'f', prototype: 'b', 'to-spec': 'c', 'to-acceptance': 'e' } }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toBe('這個階段還沒做完：create-worktree')
  })

  test('refuses while approach is untouched, naming it even though grill-with-docs is done and later nodes are resolved', () => {
    // grill 用事件開始、prototype 讀過 playbook 也開始了（corroborates grill 做完）；
    // to-spec 自己也有事件；to-acceptance／to-tickets／create-worktree 都跳過或不擋路；
    // 只有 approach 這個必做節點完全沒碰，應該是唯一被列出來的待辦。
    const missions: Missions = {
      demo: mission({
        skips: { 'to-acceptance': 'e', 'to-tickets': 'd', 'create-worktree': 'g' },
        events: [
          { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
          { at: 2, kind: 'read', name: 'playbook:prototype' },
          { at: 3, kind: 'skill', name: 'x:to-spec' },
        ],
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toBe('這個階段還沒做完：approach')
  })

  test('after grill/to-spec run via real events (not skips), the pending list names only create-worktree', () => {
    // to-spec／to-tickets 都已經被 isResolved 的 !hasStartMatcher 條件判定不擋路；
    // to-acceptance 靠 mission.acceptance.exists（模擬驗收清單已經存在）解決；approach 自己
    // 有事件、也靠後面的 prototype 真的開始了變成 done；真正擋 mission-next 的只剩
    // create-worktree 自己還沒做完。
    const missions: Missions = {
      demo: mission({
        acceptance: { exists: true, readAt: 0 },
        events: [
          { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
          { at: 2, kind: 'skill', name: 'x:approach' },
          { at: 3, kind: 'read', name: 'playbook:prototype' },
          { at: 4, kind: 'skill', name: 'x:to-spec' },
          { at: 5, kind: 'skill', name: 'x:to-tickets' },
        ],
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toBe('這個階段還沒做完：create-worktree')
  })

  test('refuses while an optional node is already started but not finished', () => {
    // prototype 一旦開始就不能悶不吭聲地跳過去：要做完，或明確 /mission-skip。
    const missions: Missions = {
      demo: mission({
        events: [
          { at: 1, kind: 'skill', name: 'x:grill-with-docs' },
          { at: 2, kind: 'read', name: 'playbook:prototype' },
        ],
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(false)
  })

  test('writes stageEnteredAt for the new stage, keeping earlier entries and backfilling any gap with createdAt', () => {
    const missions: Missions = {
      demo: mission({
        createdAt: 5,
        skips: {
          'grill-with-docs': 'a',
          approach: 'g',
          prototype: 'b',
          'to-spec': 'c',
          'to-acceptance': 'f',
          'to-tickets': 'd',
          'create-worktree': 'e',
        },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 99, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.stageEnteredAt).toEqual([5, 99])
  })

  test('refuses to leave the build stage while code-review only has its Claude track done — not just a hint, it actually blocks', () => {
    const missions: Missions = {
      demo: mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [
          { at: 11, kind: 'skill', name: 'x:implement' },
          { at: 11.6, kind: 'skill', name: 'x:no-comments' },
          { at: 12, kind: 'skill', name: 'x:cr' },
        ],
        branchCommits: [{ hash: 'a', at: 11.5 }],
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 99, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toContain('code-review')
  })

  test('refuses while no-comments is untouched, even with implement done and code-review resolved', () => {
    const missions: Missions = {
      demo: mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [{ at: 11, kind: 'skill', name: 'x:implement' }],
        branchCommits: [{ hash: 'a', at: 11.5 }],
        skips: { 'code-review:claude': '不用審', 'code-review:codex': '不用審' },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 99, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toBe('這個階段還沒做完：no-comments')
  })

  // no-comments 必做節點，這裡用真的事件做完（不是用 /mission-skip），確認往下走時
  // 真的有算進 no-comments 的完成狀態，不是因為 isResolved 的其他判準悶不吭聲放過。
  test('advances out of build once no-comments ran and code-review has both tracks explicitly skipped', () => {
    const missions: Missions = {
      demo: mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [
          { at: 11, kind: 'skill', name: 'x:implement' },
          { at: 11.6, kind: 'skill', name: 'x:no-comments' },
        ],
        branchCommits: [{ hash: 'a', at: 11.5 }],
        skips: { 'code-review:claude': '不用審', 'code-review:codex': '不用審' },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 99, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.stage).toBe(2)
  })

  test('entering the verify stage from build does not touch review (not there yet)', () => {
    const missions: Missions = {
      demo: mission({
        stage: 1,
        stageEnteredAt: [0, 10],
        events: [
          { at: 11, kind: 'skill', name: 'x:implement' },
          { at: 11.6, kind: 'skill', name: 'x:no-comments' },
        ],
        branchCommits: [{ hash: 'a', at: 11.5 }],
        skips: { 'code-review:claude': '不用審', 'code-review:codex': '不用審' },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 99, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.review).toBeUndefined()
  })

  test('entering the review stage initializes review at round 1 with roundStartedAt = now', () => {
    const missions: Missions = {
      demo: mission({ stage: 2, skips: { 'acceptance-run': 'x', 'regression-write': 'x', 'overall-regression': 'x', 'blast-radius': 'x' } }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 500, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo?.stage).toBe(3)
      expect(outcome.missions.demo?.review).toEqual({ round: 1, roundStartedAt: 500, discussions: [] })
    }
  })

  // 迴歸（bug A）：走真正的 nextStage 進入審查階段後，review 已經是 { round:1, discussions:[] }
  // 的物件（不是 undefined）。第一次真同步如果這時候就看到別人的回饋，不該被誤判成「上次
  // 同步之後出現的新回饋」而跳到第 2 輪——這份物件根本還沒有 lastSyncAt，等於還沒同步過。
  test('after the real nextStage transition into review, the first actual sync does not jump to round 2 even with existing feedback on the MR', () => {
    const missions: Missions = {
      demo: mission({ stage: 2, skips: { 'acceptance-run': 'x', 'regression-write': 'x', 'overall-regression': 'x', 'blast-radius': 'x' } }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 500, false)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const reviewStub = outcome.missions.demo?.review
    expect(reviewStub?.lastSyncAt).toBeUndefined()

    const synced = applyReviewSync(reviewStub, { mrState: 'opened', approved: false, discussions: [{ id: 'd1', isFeedback: true, resolved: false, lastBySelf: false, lastOtherNoteId: 1 }] }, 1000)
    expect(synced.round).toBe(1)
  })

  describe('reverify／push-fix 看現狀，不看輪次（第四輪設計）', () => {
    const reviewNodes = NEW_FEATURE_FLOW.stages[3]?.nodes ?? []

    test('approved with no feedback: open-mr/freeze-spec/await-review/reverify/push-fix/reply/approved 全部完成，下一步提示同步合併狀態', () => {
      const m = mission({
        stage: 3,
        events: [
          { at: 1, kind: 'product', name: 'mr', missingSections: [], mrIid: '5' },
          { at: 2, kind: 'product', name: 'issue-note' },
        ],
        acceptance: { exists: true, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 },
        review: {
          round: 1,
          roundStartedAt: 0,
          lastSyncAt: 1,
          discussions: [],
          sawFeedback: true,
          approved: true,
          localHead: 'sha-a1234567',
          remoteHead: 'sha-a1234567',
        },
      })
      const states = nodeStates(reviewNodes, m)
      expect(states.map(s => [s.node.id, s.status])).toEqual(states.map(s => [s.node.id, s.node.id === 'mr-reading-map' ? 'skip' : 'done']))
      expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe('跑 /mission-review 同步 MR 狀態；合併後才能進入下一階段')
    })

    test('a rebase after approval: reverify／push-fix 都退回未完成；下一次同步（approvedFrom 回 false）approved 也跟著退回未完成', () => {
      const rebased = mission({
        stage: 3,
        acceptance: { exists: true, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 },
        review: { round: 1, roundStartedAt: 0, lastSyncAt: 1, discussions: [], approved: true, localHead: 'sha-rebased', remoteHead: 'sha-a1234567' },
      })
      const states = nodeStates(reviewNodes, rebased)
      expect(states.find(s => s.node.id === 'reverify')?.status).not.toBe('done')
      expect(states.find(s => s.node.id === 'push-fix')?.status).not.toBe('done')

      const afterNextSync = applyReviewSync(rebased.review, { mrState: 'opened', approved: false, discussions: [] }, 2000)
      expect(afterNextSync.approved).toBe(false)
    })

    // 第五輪修正：沒有驗收清單時不再整個隱藏節點，改成自動顯示成已跳過（跟 /mission-skip
    // 同一套樣式），band 上看得到「已跳過：沒有驗收清單，不用重驗」，不是什麼都沒有。
    test('沒有整體回歸 sha（沒有驗收清單）：reverify 自動顯示成已跳過，不擋路', () => {
      const m = mission({ stage: 3, review: { round: 1, roundStartedAt: 0, lastSyncAt: 1, discussions: [] } })
      const states = nodeStates(reviewNodes, m)
      const reverify = states.find(s => s.node.id === 'reverify')
      expect(reverify?.status).toBe('skip')
      expect(reverify?.detail).toBe('沒有驗收清單，不用重驗')
      expect(isBlocking(reverify!)).toBe(false)
    })

    // 核心迴歸：重跑 /verify-acceptance 把整體回歸改成未過（或重置成未跑），節點不該消失，
    // 要留著顯示「還沒重驗過」，不能讓 band 看起來一片乾淨卻其實沒有重新驗證。
    test('重跑 /verify-acceptance 拿到「未過」：reverify 照樣列出來，顯示未完成，不是自動跳過', () => {
      const m = mission({
        stage: 3,
        acceptance: { exists: true, overall: { status: '未過' }, readAt: 0 },
        review: { round: 1, roundStartedAt: 0, lastSyncAt: 1, discussions: [], localHead: 'sha-a1234567' },
      })
      const states = nodeStates(reviewNodes, m)
      const reverify = states.find(s => s.node.id === 'reverify')
      expect(reverify?.status).not.toBe('skip')
      expect(reverify?.status).not.toBe('done')
    })

    test('整體回歸被重置成「未跑」：reverify 照樣列出來，顯示未完成', () => {
      const m = mission({
        stage: 3,
        acceptance: { exists: true, overall: { status: '未跑' }, readAt: 0 },
        review: { round: 1, roundStartedAt: 0, lastSyncAt: 1, discussions: [], localHead: 'sha-a1234567' },
      })
      const states = nodeStates(reviewNodes, m)
      const reverify = states.find(s => s.node.id === 'reverify')
      expect(reverify?.status).not.toBe('skip')
      expect(reverify?.status).not.toBe('done')
    })

    test('驗收階段整體回歸被 /mission-skip 過：reverify 自動顯示成已跳過，附帶對應原因', () => {
      const m = mission({
        stage: 3,
        acceptance: { exists: true, overall: { status: '未跑' }, readAt: 0 },
        skips: { 'overall-regression': '沒有驗收環境' },
        review: { round: 1, roundStartedAt: 0, lastSyncAt: 1, discussions: [] },
      })
      const states = nodeStates(reviewNodes, m)
      const reverify = states.find(s => s.node.id === 'reverify')
      expect(reverify?.status).toBe('skip')
      expect(reverify?.detail).toBe('驗收階段已跳過整體回歸')
    })

    // 迴歸：審查途中清單檔被歸檔或搬走，acceptance.exists 變成 false，但只要還留著 overall
    // 紀錄，節點就不該憑空消失；提示文字（resolveNodeHint）照樣叫使用者重跑整體回歸，不用
    // 因為檔案不見了而換一套說法。
    test('清單檔在審查途中被歸檔（acceptance.exists 變 false），但 overall 紀錄還留著：reverify 照樣列出來，提示照樣叫人重跑整體回歸', () => {
      const m = mission({
        stage: 3,
        acceptance: { exists: false, overall: { status: '通過', sha: 'sha-a1234567' }, readAt: 0 },
        review: { round: 1, roundStartedAt: 0, lastSyncAt: 1, discussions: [], localHead: 'sha-rebased' },
      })
      const states = nodeStates(reviewNodes, m)
      const reverify = states.find(s => s.node.id === 'reverify')
      expect(reverify?.status).not.toBe('skip')
      expect(reverify?.status).not.toBe('done')
      expect(resolveNodeHint(reverify!.node, m)).toBe('改完 code 或 rebase 之後，要重跑 /verify-acceptance 的整體回歸')
    })
  })

  test('review stage: refuses even with every node done when the MR has not been recorded as merged', () => {
    const missions: Missions = {
      demo: mission({
        stage: 3,
        events: [
          { at: 1, kind: 'product', name: 'mr', missingSections: [], mrIid: '5' },
          { at: 2, kind: 'product', name: 'issue-note' },
        ],
        review: { round: 1, roundStartedAt: 0, discussions: [], sawFeedback: true, approved: true },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 1000, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toContain('/mission-review')
  })

  test('review stage: a closed-but-not-merged MR still refuses, pointing at --force via /mission-finish', () => {
    const missions: Missions = {
      demo: mission({
        stage: 3,
        review: { round: 1, roundStartedAt: 0, discussions: [], mrState: 'closed' },
      }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 1000, false)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toContain('--force')
  })

  test('review stage: advances to finish once mrState is merged, regardless of node states', () => {
    const missions: Missions = {
      demo: mission({ stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [], mrState: 'merged' } }),
    }
    const outcome = nextStage(missions, '/repo', NEW_FEATURE_FLOW, 1000, false)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo?.stage).toBe(4)
      // review 保留（/mission-log 看歷史），finish 階段的節點不看它。
      expect(outcome.missions.demo?.review?.mrState).toBe('merged')
    }
  })
})

describe('restoreMission', () => {
  test('refuses an unknown name', () => {
    expect(restoreMission({}, '/repo', 'demo').ok).toBe(false)
  })

  test('refuses when another mission already binds this root', () => {
    const missions: Missions = { demo: mission(), other: mission({ name: 'other', binding: '/repo-2' }) }
    const outcome = restoreMission(missions, '/repo', 'other')
    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('demo')
  })

  test('rebinds the mission to this root otherwise', () => {
    const missions: Missions = { demo: mission({ binding: '/old-repo' }) }
    const outcome = restoreMission(missions, '/repo', 'demo')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.binding).toBe('/repo')
  })

  test('restoring to a worktree path (not a session binding) sets worktreePath to that path', () => {
    const missions: Missions = { demo: mission({ binding: '/old-repo' }) }
    const outcome = restoreMission(missions, '/repo/.claude/worktrees/feat_x', 'demo')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.worktreePath).toBe('/repo/.claude/worktrees/feat_x')
  })

  test('restoring to a session binding (main checkout) leaves worktreePath untouched', () => {
    const missions: Missions = { demo: mission({ binding: '/old-repo', worktreePath: '/old-repo/.claude/worktrees/feat_x' }) }
    const outcome = restoreMission(missions, 'session:sess-1', 'demo')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions.demo?.worktreePath).toBe('/old-repo/.claude/worktrees/feat_x')
  })
})

describe('finishMission', () => {
  // /cleanup 的提示不在這裡：finishMission 只回乾淨的「已清除」文字，提示由
  // finishWithCost 接在成本報告後面墊成最後一行（見 hooks/cost.ts、register.test.tsx
  // 的 /mission-cost 那組命令層測試）。
  test('deletes outright once the mission is at the last stage', () => {
    const missions: Missions = { demo: mission({ stage: 4 }) }
    const outcome = finishMission(missions, '/repo', undefined, false, NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo).toBeUndefined()
      expect(outcome.text).not.toContain('/cleanup')
    }
  })

  test('refuses --force-less finish from the review stage (not the last stage), pointing at --force', () => {
    const missions: Missions = { demo: mission({ stage: 3 }) }
    const outcome = finishMission(missions, '/repo', undefined, false, NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toContain('--force')
  })

  test('refuses before the last stage without --force', () => {
    const missions: Missions = { demo: mission({ stage: 0 }) }
    const outcome = finishMission(missions, '/repo', undefined, false, NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.text).toContain('--force')
  })

  test('deletes before the last stage once forced with the right name', () => {
    const missions: Missions = { demo: mission({ stage: 0 }) }
    const outcome = finishMission(missions, '/repo', 'demo', true, NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.missions.demo).toBeUndefined()
      expect(outcome.text).not.toContain('/cleanup')
    }
  })
})

describe('findBoundMission', () => {
  test('finds the one mission bound to a root', () => {
    const missions: Missions = { demo: mission() }
    expect(findBoundMission(missions, '/repo')?.[0]).toBe('demo')
    expect(findBoundMission(missions, '/elsewhere')).toBeUndefined()
  })
})

describe('bindingFor', () => {
  test('binds to the session in the main checkout, which many sessions share', () => {
    expect(bindingFor('/repo', '/repo', 'sess-1')).toBe('session:sess-1')
  })

  test('binds to the worktree path in a worktree, and outside any repo', () => {
    expect(bindingFor('/repo/.claude/worktrees/feat_a', '/repo', 'sess-1')).toBe('/repo/.claude/worktrees/feat_a')
    expect(bindingFor('/tmp/x', undefined, 'sess-1')).toBe('/tmp/x')
  })
})

describe('resolveMissionName', () => {
  const missions: Missions = {
    '1022-#473': mission({ name: '1022-#473' }),
    '1020-#460': mission({ name: '1020-#460', binding: '/repo-2' }),
    '1021-#460': mission({ name: '1021-#460', binding: '/repo-3' }),
  }

  test('takes the full name, or the issue number / label without the date', () => {
    expect(resolveMissionName(missions, '1022-#473')).toEqual({ name: '1022-#473' })
    expect(resolveMissionName(missions, '#473')).toEqual({ name: '1022-#473' })
    expect(resolveMissionName(missions, '473')).toEqual({ name: '1022-#473' })
  })

  test('refuses an unknown or ambiguous short name', () => {
    expect(resolveMissionName(missions, '#999')).toEqual({ error: expect.any(String) })
    const ambiguous = resolveMissionName(missions, '#460')
    expect(ambiguous).toEqual({ error: expect.stringContaining('1020-#460') })
  })
})

describe('leaving the start stage from the main checkout', () => {
  function doneStart() {
    return mission({
      name: '1022-#473',
      binding: 'session:sess-1',
      worktreePath: '/main-checkout/.claude/worktrees/1022-feat_473',
      skips: { approach: '這個測試不管 approach', prototype: '沒有設計決定', 'to-acceptance': '這個測試不管驗收清單', 'to-tickets': '小票不用拆' },
      events: [
        { at: 1, kind: 'skill', name: 'mattpocock-skills:grill-with-docs' },
        { at: 2, kind: 'skill', name: 'mattpocock-skills:to-spec' },
      ],
    })
  }

  test('mission-next points at /mission-go to continue in the worktree', () => {
    const outcome = nextStage({ '1022-#473': doneStart() }, 'session:sess-1', NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe('已進入「實作」\n下一步：打 /mission-go 在 worktree 開新分頁接續（留在這裡 cd 進去開發也追蹤得到）')
    expect(outcome.text).not.toContain('GLOSSARY')
  })

  test('prepends a reminder to move GLOSSARY／ADR over when domainDocsDirty is true', () => {
    const outcome = nextStage({ '1022-#473': doneStart() }, 'session:sess-1', NEW_FEATURE_FLOW, 0, true)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe(
      '已進入「實作」\n下一步：先把 GLOSSARY.md／ADR 的改動搬到 worktree，打 /mission-go 在 worktree 開新分頁接續（留在這裡 cd 進去開發也追蹤得到）',
    )
  })
})

describe('changing stages inside the worktree', () => {
  test('mission-next suggests /clear before the next stage', () => {
    const wt = '/main-checkout/.claude/worktrees/1022-feat_473'
    const done = mission({ name: '1022-#473', binding: wt, stage: 1, skips: { implement: '測試', 'no-comments': '測試', 'code-review': '測試' } })
    const outcome = nextStage({ '1022-#473': done }, wt, NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe(
      '已進入「驗收」\n建議先 /clear 再開始：任務綁在 worktree 路徑，清掉對話不會斷線，下一個階段從小的上下文開始累積；需要帶著前面的討論就改用 /compact',
    )
  })

  test('entering the finish stage warns against /clear because /retro reads this conversation', () => {
    const wt = '/main-checkout/.claude/worktrees/1022-feat_473'
    const merged = mission({ name: '1022-#473', binding: wt, stage: 3, review: { round: 1, roundStartedAt: 0, discussions: [], mrState: 'merged' } })
    const outcome = nextStage({ '1022-#473': merged }, wt, NEW_FEATURE_FLOW, 0, false)
    expect(outcome.ok).toBe(true)
    expect(outcome.text).toBe('已進入「收尾」\n先不要 /clear：/retro 要回顧這段對話')
  })
})

describe('restore and finish accept the short name', () => {
  test('restoreMission resolves #<issue> to the dated mission', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473', binding: 'session:sess-1' }) }
    const outcome = restoreMission(missions, '/repo/.claude/worktrees/feat_x', '#473')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.missions['1022-#473']?.binding).toBe('/repo/.claude/worktrees/feat_x')
  })

  test('finishMission --force accepts #<issue>', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473' }) }
    const outcome = finishMission(missions, '/repo', '#473', true, NEW_FEATURE_FLOW)
    expect(outcome.ok).toBe(true)
  })

  test('startMission points to restore when the name already exists', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473' }) }
    expect(startMission(missions, '1022-#473', '/repo-2', 0).text).toContain('/mission-restore')
  })
})

describe('old mission data without the new fields still loads and renders', () => {
  test('a mission with no stageEnteredAt, assets or branchCommits computes states and hints fine', () => {
    const legacy: Mission = {
      name: 'old',
      flow: 'new-feature',
      binding: '/repo',
      createdAt: 0,
      stage: 1,
      skips: {},
      events: [{ at: 1, kind: 'skill', name: 'x:implement' }],
    }
    const buildNodes = NEW_FEATURE_FLOW.stages[1]?.nodes ?? []
    const states = nodeStates(buildNodes, legacy)
    expect(states[0]?.status).toBe('started')
    expect(nextStepHint(NEW_FEATURE_FLOW, legacy)).toContain('no-comments')
    expect(ticketsChangedSinceBuild(NEW_FEATURE_FLOW, legacy)).toBe(false)
  })
})

describe('withSessionId', () => {
  const wt = '/repo/.claude/worktrees/feat_x'

  test('appends the session id to the bound mission', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473', binding: wt }) }
    const next = withSessionId(missions, wt, 'sess-a')
    expect(next['1022-#473']?.sessionIds).toEqual(['sess-a'])
  })

  test('keeps earlier ids and adds a new one after /clear', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473', binding: wt, sessionIds: ['sess-a'] }) }
    expect(withSessionId(missions, wt, 'sess-b')['1022-#473']?.sessionIds).toEqual(['sess-a', 'sess-b'])
  })

  test('returns the same reference when the id is already recorded', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473', binding: wt, sessionIds: ['sess-a'] }) }
    expect(withSessionId(missions, wt, 'sess-a')).toBe(missions)
  })

  test('returns the same reference when nothing is bound here', () => {
    const missions: Missions = { '1022-#473': mission({ name: '1022-#473', binding: '/elsewhere' }) }
    expect(withSessionId(missions, wt, 'sess-a')).toBe(missions)
  })
})

describe('mr-reading-map 節點（審查階段）', () => {
  const reviewNodes = NEW_FEATURE_FLOW.stages[3]?.nodes ?? []
  const mrOpened = [
    { at: 1, kind: 'product' as const, name: 'mr', missingSections: [], mrIid: '512' },
    { at: 2, kind: 'product' as const, name: 'issue-note' },
  ]

  test('排在 freeze-spec 之後、await-review 之前', () => {
    const ids = reviewNodes.map(node => node.id)
    expect(ids.indexOf('mr-reading-map')).toBe(ids.indexOf('freeze-spec') + 1)
    expect(ids.indexOf('await-review')).toBe(ids.indexOf('mr-reading-map') + 1)
  })

  test('開完 MR、凍結 spec 後，下一步提示帶入 MR 號，並說明不需要時怎麼辦', () => {
    const m = mission({ stage: 3, events: mrOpened })
    const hint = nextStepHint(NEW_FEATURE_FLOW, m)
    expect(hint).toContain('/mr-reading-map 512')
    expect(hint).toContain('不需要')
    expect(hint).toContain('/mission-skip mr-reading-map')
  })

  test('還不知道 MR 號時提示用佔位字', () => {
    const node = reviewNodes.find(n => n.id === 'mr-reading-map')
    if (node === undefined) throw new Error('missing node')
    expect(resolveNodeHint(node, mission({ stage: 3 }))).toContain('/mr-reading-map <MR 號>')
  })

  test('跑過 /mr-reading-map 就算完成，下一步換成等審查', () => {
    const m = mission({ stage: 3, events: [...mrOpened, { at: 3, kind: 'skill', name: 'mr-reading-map' }] })
    expect(nodeStates(reviewNodes, m).find(s => s.node.id === 'mr-reading-map')?.status).toBe('done')
    expect(nextStepHint(NEW_FEATURE_FLOW, m)).toBe('等同事看過之後，跑 /mission-review 同步 MR 狀態')
  })

  test('MR 已核准還沒跑過就自動顯示成已跳過，不擋路', () => {
    const m = mission({ stage: 3, events: mrOpened, review: { round: 1, roundStartedAt: 0, discussions: [], approved: true } })
    const state = nodeStates(reviewNodes, m).find(s => s.node.id === 'mr-reading-map')
    if (state === undefined) throw new Error('missing node')
    expect(state.status).toBe('skip')
    expect(isBlocking(state)).toBe(false)
  })
})
