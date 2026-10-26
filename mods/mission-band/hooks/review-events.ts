// hooks/review-stage.ts 的純函式接到 $：glab api 同步（MR 狀態／核准／討論）、git 查本機與
// 遠端分支的 HEAD、本機回覆偵測怎麼寫回任務。跟 register.tsx 分開放，讓 register.tsx 專心做
// hook 註冊（products.ts 已經 399 行，新邏輯不往那裡疊）。
import type { EngineInterface } from 'claude-code'

import { NEW_FEATURE_FLOW } from '../flows/new-feature'
import type { MissionReview } from '../types'
import { tryParseJson } from './products'
import { findBoundMission, REVIEW_STAGE_ID, stageAt } from './model'
import { ownProjectPathOf } from './product-events'
import {
  applyReviewSync,
  approvedFrom,
  classifyDiscussion,
  discussionReplyMatch,
  markDiscussionRepliedLocally,
  mrStateFrom,
  type RawReviewDiscussion,
  resolveMrIid,
  type ReviewSyncSnapshot,
  usernameFrom,
} from './review-stage'
import { currentBinding, loadMissions, mutate } from './store'

async function glabJson($: EngineInterface, argv: readonly string[], cwd: string): Promise<unknown | undefined> {
  const result = await $.process.run(argv, { cwd })
  if (result.exitCode !== 0) return undefined
  return tryParseJson(result.stdout)
}

const DISCUSSIONS_PAGE_SIZE = 100
const DISCUSSIONS_PAGE_CAP = 10

/**
 * 討論列表要分頁抓完，不是只抓第一頁就當作全部——per_page=100 剛好卡在 100 筆的 MR
 * 會被靜默截斷，漏掉的討論可能剛好是還沒回的那幾則。頁數上限 10（最多 1000 筆）純粹
 * 防呆，正常不會碰到；某一頁讀失敗（exitCode 非 0 或不是陣列）整個回 undefined，呼叫端
 * 當同步失敗處理，不要用「讀到一半」的不完整清單覆蓋掉舊資料。
 */
async function fetchAllDiscussions($: EngineInterface, projectToken: string, mrIid: string, cwd: string): Promise<unknown[] | undefined> {
  const all: unknown[] = []
  for (let page = 1; page <= DISCUSSIONS_PAGE_CAP; page += 1) {
    const json = await glabJson($, ['glab', 'api', `projects/${projectToken}/merge_requests/${mrIid}/discussions?per_page=${DISCUSSIONS_PAGE_SIZE}&page=${page}`], cwd)
    if (!Array.isArray(json)) return undefined
    all.push(...json)
    if (json.length < DISCUSSIONS_PAGE_SIZE) break
  }
  return all
}

export type ReviewSyncOutcome = { ok: true; text: string; merged: boolean } | { ok: false; text: string }

/**
 * `/mission-review` 的核心：打 glab api 同步 MR 狀態／核准／討論，寫回 mission.review，
 * 回一句摘要文字。任何一步失敗（glab 掛了、approvals／自己帳號讀不到、讀不到專案路徑）
 * 都只回錯誤文字、完全不寫 store——approvals 讀失敗不能當「沒人核准」處理，自己的帳號
 * 讀失敗也不能用 undefined 硬分類討論（會把自己發的 note 誤判成別人的）。自己的帳號只在
 * 還沒快取過時才查一次（selfUsername）。成功之後順手刷新一次本機／遠端 HEAD，不等下一個
 * Bash 或 turn.complete，不然同步完 reverify／push-fix 節點還是舊資料。
 */
export async function syncReview($: EngineInterface, binding: string, now: number): Promise<ReviewSyncOutcome> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined) return { ok: false, text: '這裡沒有綁定任務' }
  const [, mission] = bound

  if (stageAt(NEW_FEATURE_FLOW, mission.stage).id !== REVIEW_STAGE_ID) return { ok: false, text: '還沒到審查階段' }

  // ownProjectPath 要先問出來：舊任務的 mr 事件沒帶 mrIid，resolveMrIid 要靠它從資產清單
  // 篩出「這個專案自己的」MR 網址，不然會誤認別的專案的 MR（見 hooks/review-stage.ts）。
  const ownProjectPath = await ownProjectPathOf($)
  const mrIid = resolveMrIid(mission, ownProjectPath)
  if (mrIid === undefined) return { ok: false, text: '還沒偵測到 MR' }
  if (ownProjectPath === undefined) return { ok: false, text: '讀不到這個 repo 的 GitLab 專案路徑' }
  const projectToken = encodeURIComponent(ownProjectPath)
  const cwd = mission.worktreePath ?? (await $.session.root())

  let mrJson: unknown
  let approvalsJson: unknown
  let rawDiscussions: unknown[] | undefined
  try {
    mrJson = await glabJson($, ['glab', 'api', `projects/${projectToken}/merge_requests/${mrIid}`], cwd)
    approvalsJson = await glabJson($, ['glab', 'api', `projects/${projectToken}/merge_requests/${mrIid}/approvals`], cwd)
    rawDiscussions = await fetchAllDiscussions($, projectToken, mrIid, cwd)
  } catch (error) {
    return { ok: false, text: `同步失敗：glab api 執行出錯：${String(error)}` }
  }

  const mrState = mrStateFrom(mrJson)
  if (mrState === undefined) return { ok: false, text: '同步失敗：glab api 讀不到這個 MR' }
  if (approvalsJson === undefined) return { ok: false, text: '同步失敗：glab api 讀不到核准狀態' }
  if (rawDiscussions === undefined) return { ok: false, text: '同步失敗：glab api 讀不到討論列表' }

  let selfUsername = mission.review?.selfUsername
  if (selfUsername === undefined) {
    let userJson: unknown
    try {
      userJson = await glabJson($, ['glab', 'api', 'user'], cwd)
    } catch (error) {
      return { ok: false, text: `同步失敗：glab api 讀不到自己的帳號：${String(error)}` }
    }
    selfUsername = usernameFrom(userJson)
    if (selfUsername === undefined) return { ok: false, text: '同步失敗：glab api 讀不到自己的帳號' }
  }

  const discussions = rawDiscussions
    .map(raw => classifyDiscussion(raw as RawReviewDiscussion, selfUsername))
    .filter((d): d is NonNullable<ReturnType<typeof classifyDiscussion>> => d !== undefined)

  const snapshot: ReviewSyncSnapshot = { mrState, approved: approvedFrom(approvalsJson), selfUsername, discussions }

  let nextReview: MissionReview | undefined
  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined) return missions
    const [name, m] = bound2
    nextReview = applyReviewSync(m.review, snapshot, now)
    return {
      ...missions,
      [name]: {
        ...m,
        review: nextReview,
        events: [...m.events, { at: now, kind: 'product' as const, name: 'review-sync', round: nextReview.round }].slice(-300),
      },
    }
  })

  const review = nextReview ?? applyReviewSync(mission.review, snapshot, now)
  const feedbackCount = discussions.filter(d => d.isFeedback).length
  const awaitingCount = discussions.filter(d => d.isFeedback && !d.resolved && !d.lastBySelf).length
  const closedSuffix = mrState === 'closed' ? `｜MR 已關閉沒合併，用 /mission-finish ${mission.name} --force 收尾` : ''
  const text = `MR ${mrState}｜${review.approved === true ? '已核准' : '未核准'}｜${feedbackCount} 則回饋討論｜${awaitingCount} 則待回｜第 ${review.round} 輪${closedSuffix}`

  await maybeRefreshReviewHeads($, binding)
  return { ok: true, text, merged: mrState === 'merged' }
}

/** 本機 HEAD 跟遠端上游（`@{u}`）的 HEAD；上游名稱可能跟本機分支名不同，不能用 origin/<本機分支名> 猜。 */
async function currentHeads($: EngineInterface, cwd: string): Promise<{ local?: string; remote?: string } | undefined> {
  try {
    const headResult = await $.process.run(['git', 'rev-parse', 'HEAD'], { cwd })
    if (headResult.exitCode !== 0) return undefined
    const local = headResult.stdout.trim()

    // detached HEAD 或沒設上游都會讓這支指令非 0 退出；兩種情況都當「遠端未知」，
    // 不去猜 origin/<本機分支名>——上游名稱可能跟本機分支名不一樣。
    const upstreamResult = await $.process.run(['git', 'rev-parse', '@{u}'], { cwd })
    return { local, remote: upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : undefined }
  } catch {
    return undefined
  }
}

/**
 * push-fix 節點要比對的本機／遠端 HEAD；只在審查階段、且已經同步過一次（mission.review
 * 存在）才查——離開審查階段不用再查，還沒進審查也沒有 round 基準可比；查不到（git 失敗、
 * worktree 目錄不見了）就放過，不清空既有的快取值。
 */
export async function maybeRefreshReviewHeads($: EngineInterface, binding: string): Promise<void> {
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined || bound[1].review === undefined) return
  if (stageAt(NEW_FEATURE_FLOW, bound[1].stage).id !== REVIEW_STAGE_ID) return
  const [, mission] = bound

  const cwd = mission.worktreePath ?? (await $.session.root())
  const heads = await currentHeads($, cwd)
  if (heads === undefined) return

  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined || bound2[1].review === undefined) return missions
    const [name, m] = bound2
    const review = m.review
    if (review === undefined || (review.localHead === heads.local && review.remoteHead === heads.remote)) return missions
    return { ...missions, [name]: { ...m, review: { ...review, localHead: heads.local, remoteHead: heads.remote } } }
  })
}

/**
 * 成功發出一則討論回覆（glab api POST 到 discussions/<id>/notes，見
 * hooks/review-stage.ts 的 discussionReplyMatch）就把那個討論記成「最後一則是自己」，
 * 不用等下一次 /mission-review 同步；被拒絕執行、出錯、或 --dry-run 都不算。
 */
export async function maybeRecordDiscussionReply($: EngineInterface, binding: string, command: string, ranSuccessfully: boolean): Promise<void> {
  if (!ranSuccessfully) return
  const bound = findBoundMission(await loadMissions($), binding)
  if (bound === undefined || bound[1].review === undefined) return

  const ownProjectPath = await ownProjectPathOf($)
  const mrIid = resolveMrIid(bound[1], ownProjectPath)
  if (mrIid === undefined) return

  const discussionId = discussionReplyMatch(command, mrIid, ownProjectPath)
  if (discussionId === undefined) return

  await mutate($, missions => {
    const bound2 = findBoundMission(missions, binding)
    if (bound2 === undefined || bound2[1].review === undefined) return missions
    const [name, m] = bound2
    return { ...missions, [name]: { ...m, review: markDiscussionRepliedLocally(m.review as MissionReview, discussionId) } }
  })
}
