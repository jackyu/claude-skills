import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import { handleAcceptanceFileWrite, maybeRefreshAcceptance } from './acceptance-events'
import { linkAsset, parseLinkArgs, parseUnlinkArgs, unlinkAsset } from './asset-commands'
import { extractCandidateUrls, isGrillWithDocsPrompt, issueUrlFromRemote, looksLikeIssueReadCommand, projectNameFor, projectPathFromRemote } from './assets'
import { bandPlan } from './band'
import { renderRow, stepsBox } from './band-render'
import { parseFinishArgs, parseRenameArgs, parseRestoreArgs, parseSkipArgs, parseStartArgs } from './command-args'
import { MISSION_COMMANDS } from './commands'
import { finishWithCost, missionCostText, rememberSession, runMutationAndRemember } from './cost'
import { missionGoText } from './handoff'
import { missionHelpText, openGuide } from './help'
import {
  bindingFor,
  finishMission,
  findBoundMission,
  issueIidFromMissionName,
  nextStage,
  renameMission,
  restoreMission,
  skipNode,
  startMission,
  stripPluginPrefix,
} from './model'
import { maybeRecordIssueNoteEvent, maybeRecordMrEvent, maybeUpdateBranchCommits } from './product-events'
import { codexCliReviewNamesIn, looksLikeMrCommand, pstackReadNames, pstackReadsInBashCommand } from './products'
import { confirmProgressContext, resetProgressContext, withProgressContext } from './prompt-context'
import { maybeRecordDiscussionReply, maybeRefreshReviewHeads, syncReview } from './review-events'
import { listMissionsText, missionLogText } from './reporting'
import { formatSetupGaps, setupGaps } from './setup'
import { gatherSetupFacts } from './setup-facts'
import { bashStdout, currentBinding, loadMissions, recordAssets, recordEvent, refreshMissionsState, runMutation, runStep } from './store'
import { domainDocsDirty, maybeRecordWorktreePath } from './worktree-events'

// update／read 的 ref 只認得這個檔案裡寫死的字面常數，跟 store.ts 內部用的那份分開宣告
// （ref 內容相同，底層就是同一份 state，見 store.ts 開頭的註解）。
const missionsRef = { plugin: 'mission-band', key: 'missions' } as const
const missionsState = atom(missionsRef, {})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 指令先註冊，store 讀取失敗也不會連指令都掉了；完整清單見 hooks/commands.ts。
    for (const spec of MISSION_COMMANDS) await $.command.register(spec)

    try {
      const missions = await loadMissions($)
      await update($, missionsState, () => missions)
    } catch (error) {
      $.ui.log(`mission-band: 讀取任務資料失敗，先當作沒有任務：${String(error)}`)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 只有打 /grill-with-docs 才掃網址，避免平常貼的連結被收進來；要在下面的 store 重讀
    // 之前做完，重讀才會看到這次加進去的資產。
    if (isGrillWithDocsPrompt(e.text)) {
      await recordAssets($, extractCandidateUrls(e.text), 'prompt')
    }

    // 每次送出前補讀 store，才看得到別的 session 跑的 /mission-finish、/mission-restore（細節在 store.ts）。
    await refreshMissionsState($)

    return next(await withProgressContext($, e))
  }).catch(($, e, next) => next(e))

  // 子 agent 自己的壓縮不影響主對話看到的進度
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await resetProgressContext($)
    return result
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    await recordEvent($, { at: await $.clock.now(), kind: 'skill', name: e.skill })

    // skill 剛被呼叫、還沒寫檔，這裡多半只刷出 exists:false；留著是為了重跑時先確認快取的檔名還對。
    // 最新內容要等寫完檔後的 turn.complete 或 Write／Edit 才刷得到。
    if (stripPluginPrefix(e.skill) === 'to-acceptance') {
      await runStep($, '驗收清單刷新', async () => maybeRefreshAcceptance($, await currentBinding($)))
    }

    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    for (const name of pstackReadNames(e.file_path)) {
      await recordEvent($, { at: await $.clock.now(), kind: 'read', name, agentId: e.agentId })
    }

    return result
  }).catch(($, e, next) => next(e))

  // subagent 派工合約規定每個 Bash 都先 cd <絕對路徑>，所以實際指令常是
  // `cd /abs && head -n 1 '<path>'`；pstackReadsInBashCommand 會照 && / || / ; / | 切開
  // 再逐段判斷是不是讀檔，cd／grep 那幾段就算了路徑字串也不算一次讀取。
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // 先讓 next(e) 把指令真的跑完，才看結果——不能在這之前就記事件，不然記到的是
    // 「使用者要跑這個指令」而不是「這個指令真的跑了」。next(e) 的結果是三種之一：
    // deny（被拒絕執行，沒有 result）、isError: true（core 判定這次呼叫出錯：丟例外、
    // 被中斷、或答案本身是錯誤）、或正常帶 result。Codex CLI 審查這種「跑了才算數」的
    // 事件只在正常完成時記；deny／isError 都不記，避免使用者拒絕執行或指令出錯也被
    // 當成跑過一次審查。
    const call = await next(e)
    const { result } = call
    const ranSuccessfully = call.deny === undefined && call.isError !== true

    // 外層留一個整體 try：萬一哪個步驟漏了自己的 catch、或 runStep 之外的程式碼本身
    // 出錯，還有這層接住，避免丟出去的錯誤被外層的 .catch 接住又重跑一次 next(e)，
    // 害同一個指令意外執行兩遍。底下每個步驟再用 runStep 各自隔離：單一步驟失敗
    // 只記那一步，不會連累後面的步驟一起不跑。無論成功失敗都把原本的 call 回傳。
    try {
      await runStep($, 'pstack 讀取事件記錄', async () => {
        for (const name of pstackReadsInBashCommand(e.command)) {
          await recordEvent($, { at: await $.clock.now(), kind: 'read', name, agentId: e.agentId })
        }
      })

      // code-review 的 Codex 軌道除了 skill／Agent 事件，也認得直接跑 Codex CLI
      // （codex review／codex exec）；比對規則在 products.ts，這裡只負責記錄，
      // 且只在指令真的成功跑完時記（見上面 ranSuccessfully 的說明）。背景執行
      // （run_in_background）在送進背景的那一刻就記，不等它真正跑完——Codex 審查通常
      // 跑很久，一般都會背景執行，不在送出當下記的話就永遠不會被算進去。
      await runStep($, 'Codex CLI 審查事件記錄', async () => {
        if (!ranSuccessfully) return
        for (const name of codexCliReviewNamesIn(e.command)) {
          await recordEvent($, { at: await $.clock.now(), kind: 'bash', name, agentId: e.agentId })
        }
      })

      const stdout = bashStdout(result)
      await runStep($, '資產記錄', async () => {
        if (looksLikeIssueReadCommand(e.command) || looksLikeMrCommand(e.command)) {
          await recordAssets($, extractCandidateUrls(stdout), 'tool')
        }
      })

      const binding = await currentBinding($)
      // commit 快照不看 stdout：背景 Bash 沒有 stdout，但同樣可能已經 commit 過，
      // 直接問 git 本身才查得到；MR 偵測要看 stdout，只有 foreground 才有。
      await runStep($, '分支 commit 快照', () => maybeUpdateBranchCommits($, binding))
      await runStep($, 'MR 事件記錄', () => maybeRecordMrEvent($, binding, e.command, stdout))
      await runStep($, 'issue 留言事件記錄', () => maybeRecordIssueNoteEvent($, binding, e.command))
      await runStep($, 'worktree 路徑偵測', () => maybeRecordWorktreePath($, binding, e.command, stdout, e.agentId))
      await runStep($, '審查討論回覆偵測', () => maybeRecordDiscussionReply($, binding, e.command, ranSuccessfully))
      await runStep($, '審查本機／遠端 HEAD', () => maybeRefreshReviewHeads($, binding))
    } catch (error) {
      $.ui.log(`mission-band: 處理 Bash 結果失敗：${String(error)}`)
    }

    return call
  }).catch(($, e, next) => next(e))

  // Write／Edit 寫到驗收清單檔就刷新；寫到 worktree 自己那份底下只提醒位置寫錯；寫到
  // 不相關的檔案什麼都不做——細節（含 worktree 判斷、runStep 隔離）在
  // acceptance-events.ts 的 handleAcceptanceFileWrite，不寫在這裡：hooks 模組規定 $
  // 只能在呼叫現場直接 $.noun.event(...)，不能傳給這個檔案自己的區域函式，但可以傳給
  // 從別的檔案 import 進來的函式。
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    await handleAcceptanceFileWrite($, e.file_path)
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    await handleAcceptanceFileWrite($, e.file_path)
    return result
  }).catch(($, e, next) => next(e))

  // Agent 工具呼叫（含 subagent_type，例如 codex:codex-rescue）記成 agent 事件；
  // 比對規則在 flow 節點的 matchAgentPrefix，這裡只負責記錄，不負責判斷。
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const result = await next(e)

    // 跟 Bash 那段一樣包一層 try：recordEvent／store 這裡出錯不該被外層的
    // .catch(next(e)) 接住又重跑一次 next(e)，害同一個 Agent 呼叫意外重派一次子代理。
    try {
      if (e.subagent_type !== undefined) {
        await recordEvent($, { at: await $.clock.now(), kind: 'agent', name: e.subagent_type, agentId: e.agentId })
      }
    } catch (error) {
      $.ui.log(`mission-band: 處理 Agent 工具呼叫結果失敗：${String(error)}`)
    }

    return result
  }).catch(($, e, next) => next(e))

  // 背景 Bash 拿不到 stdout，但它結束會觸發下一個 turn，所以在這裡補查 commit 快照；子 agent 的
  // Bash 已在 tool.call 處理過，有 agentId 就跳過。先 next(e) 結束 turn，查 git 才不會拖慢它。
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)

    if (e.agentId === undefined) {
      await runStep($, '進度確認', () => confirmProgressContext($))
      await runStep($, '記錄 session', () => rememberSession($))
      const binding = await currentBinding($)
      await maybeUpdateBranchCommits($, binding)
      await runStep($, '驗收清單刷新', () => maybeRefreshAcceptance($, binding))
      await runStep($, '審查本機／遠端 HEAD', () => maybeRefreshReviewHeads($, binding))
    }

    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mission-start' }, async ($, e) => {
    const now = await $.clock.now()
    const repo = await $.session.repo()
    const parsed = parseStartArgs(e.args, now, projectPathFromRemote(repo?.remote))
    if ('error' in parsed) return { text: parsed.error }

    const gaps = setupGaps(await gatherSetupFacts($))
    if (gaps.length > 0) return { text: formatSetupGaps(gaps) }

    const binding = await currentBinding($)
    const iid = issueIidFromMissionName(parsed.name)
    const issueUrl = iid === undefined ? undefined : issueUrlFromRemote(repo?.remote ?? null, iid)

    return runMutationAndRemember($, missions => startMission(missions, parsed.name, binding, now, issueUrl, iid))
  })

  on('command.run', { command: 'mission-restore' }, async ($, e) => {
    const parsed = parseRestoreArgs(e.args)
    if ('error' in parsed) return { text: parsed.error }

    const binding = await currentBinding($)
    return runMutationAndRemember($, missions => restoreMission(missions, binding, parsed.name))
  })

  on('command.run', { command: 'mission-rename' }, async ($, e) => {
    const repo = await $.session.repo()
    const parsed = parseRenameArgs(e.args, projectPathFromRemote(repo?.remote))
    if ('error' in parsed) return { text: parsed.error }

    const iid = issueIidFromMissionName(parsed.label)
    const issueUrl = iid === undefined ? undefined : issueUrlFromRemote(repo?.remote ?? null, iid)
    const now = await $.clock.now()
    return runMutation($, missions => renameMission(missions, parsed.query, parsed.label, now, issueUrl))
  })

  on('command.run', { command: 'mission-skip' }, async ($, e) => {
    const parsed = parseSkipArgs(e.args)
    if ('error' in parsed) return { text: parsed.error }

    const binding = await currentBinding($)
    return runMutation($, missions => skipNode(missions, binding, parsed.nodeId, parsed.reason, NEW_FEATURE_FLOW))
  })

  on('command.run', { command: 'mission-next' }, async $ => {
    const binding = await currentBinding($)
    const now = await $.clock.now()
    const dirty = await domainDocsDirty($)
    return runMutation($, missions => nextStage(missions, binding, NEW_FEATURE_FLOW, now, dirty))
  })

  on('command.run', { command: 'mission-cost' }, async ($, e) => ({ text: await missionCostText($, e.args, NEW_FEATURE_FLOW) }))

  on('command.run', { command: 'mission-help' }, async $ => ({ text: await missionHelpText($) }))

  on('command.run', { command: 'mission-go' }, async $ => {
    const binding = await currentBinding($)
    return { text: await missionGoText($, binding) }
  })

  // 同步到 merged 就順手推進階段（nextStage 本身認得 review 的 mrState，見 model.ts）；
  // 不是 merged 就只回同步結果，階段留在審查。
  on('command.run', { command: 'mission-review' }, async $ => {
    const binding = await currentBinding($)
    const now = await $.clock.now()
    const sync = await syncReview($, binding, now)
    if (!sync.ok || !sync.merged) return { text: sync.text }

    const dirty = await domainDocsDirty($)
    const advance = await runMutation($, missions => nextStage(missions, binding, NEW_FEATURE_FLOW, now, dirty))
    return { text: `${sync.text}\n${advance.text}` }
  })

  on('command.run', { command: 'mission-finish' }, async ($, e) => {
    const parsed = parseFinishArgs(e.args)
    const binding = await currentBinding($)
    return finishWithCost($, parsed.name, NEW_FEATURE_FLOW, missions => finishMission(missions, binding, parsed.name, parsed.force, NEW_FEATURE_FLOW))
  })

  on('command.run', { command: 'mission-list' }, async $ => {
    const binding = await currentBinding($)
    const missions = await loadMissions($)
    return { text: listMissionsText(missions, binding, NEW_FEATURE_FLOW) }
  })

  on('command.run', { command: 'mission-log' }, async $ => {
    const binding = await currentBinding($)
    const missions = await loadMissions($)
    return { text: missionLogText(missions, binding) }
  })

  on('command.run', { command: 'mission-link' }, async ($, e) => {
    const parsed = parseLinkArgs(e.args)
    if ('error' in parsed) return { text: parsed.error }

    const binding = await currentBinding($)
    const now = await $.clock.now()
    return runMutation($, missions => linkAsset(missions, binding, parsed.label, parsed.url, now))
  })

  on('command.run', { command: 'mission-unlink' }, async ($, e) => {
    const parsed = parseUnlinkArgs(e.args)
    if ('error' in parsed) return { text: parsed.error }

    const binding = await currentBinding($)
    return runMutation($, missions => unlinkAsset(missions, binding, parsed.label))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const missions = await read($, missionsState)
    const binding = await currentBinding($)
    const bound = findBoundMission(missions, binding)
    if (bound === undefined) return next(e)

    const [, mission] = bound
    const repo = await $.session.repo()
    const projectName = projectNameFor(repo)
    const plan = bandPlan(mission, NEW_FEATURE_FLOW, e.props.bodyColumns, e.props.maxRows, projectName, await $.clock.now())
    const { Box, Text, Link, Button } = $.ui.resolve(e)

    if (plan.mode === 'narrow') {
      // 中文字一個字佔兩個 cell，不能用字元數裁切（UTF-16 的 .slice 會切錯寬度）；
      // 固定 Box 寬度，讓 Text 自己用 cell 寬度裁切＋補「…」。
      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          <Text dimColor wrap="truncate-end">
            {plan.line}
          </Text>
        </Box>
      )
    }

    // 畫 segment／列／步驟框的邏輯在 band-render.tsx（不碰 $，純吃這三個元素跟 band.ts
    // 算好的資料），這裡只負責組版面。
    const elements = { Box, Text, Link }
    const warningRows = plan.warnings.map(row => renderRow(elements, row))

    // tabs 列最右側的「?」說明按鈕，開 docs/guide.html 教學頁；band.ts 的 HELP_BUTTON_WIDTH 已經先留位置。
    const tabsWithHelp = (
      <Box flexDirection="row" width={e.props.bodyColumns} justifyContent="space-between">
        {renderRow(elements, plan.tabs)}
        <Button key="help" hotkey="h" plain onPress={() => openGuide($)}>?</Button>
      </Box>
    )

    if (plan.mode === 'steps-only') {
      return (
        <Box flexDirection="column">
          {tabsWithHelp}
          {warningRows}
          {stepsBox(elements, plan.steps, undefined)}
          {renderRow(elements, plan.next)}
        </Box>
      )
    }

    const assetsBox = (
      <Box key="assets" flexDirection="column" borderStyle="round" flexGrow={1}>
        <Text bold>資產</Text>
        {plan.assets.map(row => renderRow(elements, row))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {tabsWithHelp}
        {warningRows}
        <Box flexDirection="row">
          {stepsBox(elements, plan.steps, '40%')}
          {assetsBox}
        </Box>
        {renderRow(elements, plan.next)}
      </Box>
    )
  })
}
