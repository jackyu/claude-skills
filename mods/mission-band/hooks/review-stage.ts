// 審查階段的純函式層：GitLab 討論怎麼分類成「回饋」、同步後輪次怎麼算、五個節點的完成判斷、
// 本機回覆偵測怎麼比對 Bash 指令。不碰 $，$ 這層的 glab api／git 呼叫在 hooks/review-events.ts。
import type { Mission, MissionReview, ReviewDiscussion } from '../types'
import { shaDiffers } from './acceptance-events'
import { classifyUrl, gitlabIid, gitlabProjectPath, missionAssets } from './assets'
import { DRY_RUN_FLAG_PATTERN, matchesOwnProject } from './products'
import type { DoneWhenResult } from './products'

// ===== GitLab 討論分類 =====

export type RawReviewNote = {
  id?: number
  body: string
  system?: boolean
  resolvable?: boolean
  resolved?: boolean
  author?: { username?: string }
}

export type RawReviewDiscussion = { id: string; notes?: readonly RawReviewNote[] }

// 閱讀地圖導覽註解的識別：第一則首行 🤖💬 開頭，且含這個自我標記。
const TOUR_NOTE_PREFIX = '🤖💬'
const TOUR_NOTE_MARKER = '<!-- mr:self-annotation -->'

function isTourNote(note: RawReviewNote): boolean {
  return note.body.trimStart().startsWith(TOUR_NOTE_PREFIX) && note.body.includes(TOUR_NOTE_MARKER)
}

function isBySelf(note: RawReviewNote, selfUsername: string | undefined): boolean {
  return selfUsername !== undefined && note.author?.username === selfUsername
}

/** 別人發的 note 裡最大的 note id；GitLab note id 全站單調遞增，比這個就不用比時間戳。 */
function maxNoteId(notes: readonly RawReviewNote[]): number | undefined {
  const ids = notes.map(note => note.id).filter((id): id is number => id !== undefined)
  return ids.length === 0 ? undefined : Math.max(...ids)
}

/**
 * 單一討論分類成 ReviewDiscussion；系統 note 先濾掉，濾完沒有任何 note 就不是討論（回 undefined）。
 * isFeedback 只排除「導覽註解、且沒有別人回覆」那一種——用標記判斷，不用作者判斷：自己留的
 * 非導覽提醒（例如「這裡還要改」）照樣算回饋討論，只是因為最後一則就是自己，reply 節點本來
 * 就會判斷完成，不需要額外排除。導覽註解底下只要有別人回覆，整串就轉成一般回饋討論。
 */
export function classifyDiscussion(raw: RawReviewDiscussion, selfUsername: string | undefined): ReviewDiscussion | undefined {
  const notes = (raw.notes ?? []).filter(note => note.system !== true)
  const first = notes[0]
  if (first === undefined) return undefined

  const othersNotes = notes.filter(note => !isBySelf(note, selfUsername))
  const isTourWithNoReply = isTourNote(first) && othersNotes.length === 0
  const isFeedback = !isTourWithNoReply

  const lastNote = notes.at(-1)
  const lastBySelf = lastNote !== undefined && isBySelf(lastNote, selfUsername)

  // 只有可解決（resolvable）的 note 才看 resolved；沒有任何可解決的 note（單純留言）
  // 一律當沒解決，reply 節點靠 lastBySelf 判斷完成，不靠 resolved。
  const resolvableNotes = notes.filter(note => note.resolvable === true)
  const resolved = resolvableNotes.length > 0 && resolvableNotes.every(note => note.resolved === true)

  return { id: raw.id, isFeedback, resolved, lastBySelf, lastOtherNoteId: maxNoteId(othersNotes) }
}

// ===== 同步後套用（輪次、sawFeedback） =====

export type ReviewSyncSnapshot = {
  mrState: 'opened' | 'merged' | 'closed'
  approved: boolean
  selfUsername?: string
  discussions: readonly ReviewDiscussion[]
}

/**
 * 這次同步跟上次比，有沒有「新的別人回覆」：對每個回饋討論比對別人 note 的最大 id，
 * 比上次快照記的高就算新的；討論在上次快照裡完全沒出現（新開的討論）也算——上次的最大值
 * 當作沒有（undefined），只要這次有任何別人 note 就算新。不比時間戳：GitLab note 的
 * created_at 是伺服器時間，跟本機時鐘／呼叫前就算好的 now 對不齊，見本函式上層的呼叫端。
 */
function hasNewOtherNotes(prevDiscussions: readonly ReviewDiscussion[], nextDiscussions: readonly ReviewDiscussion[]): boolean {
  const prevById = new Map(prevDiscussions.map(d => [d.id, d]))
  return nextDiscussions.some(d => {
    if (!d.isFeedback || d.lastOtherNoteId === undefined) return false
    const prevMax = prevById.get(d.id)?.lastOtherNoteId
    return prevMax === undefined || d.lastOtherNoteId > prevMax
  })
}

/**
 * 套用一次同步結果：round／roundStartedAt／sawFeedback 是跨同步累積的欄位，其餘
 * （mrState／approved／discussions／selfUsername）整份覆蓋成這次同步的結果。輪次遞增
 * 條件見 hasNewOtherNotes；第一次同步（base.lastSyncAt 還沒寫過）一律不算新一輪——進入
 * 審查時已經是第 1 輪，第一次看到的回饋就屬於第 1 輪，不該一同步就跳到第 2 輪。
 *
 * 判斷「是不是第一次同步」要看 base.lastSyncAt，不能看 prev 是不是 undefined：進入審查
 * 階段時（見 model.ts 的 nextStage）會先建立一份 round 1、discussions 是空陣列、但沒有
 * lastSyncAt 的 review 物件，這份 prev 不是 undefined；如果拿 prev===undefined 當判準，
 * 這份預建物件就會被誤判成「已經同步過一次」，MR 上既有的回饋會讓第一次同步直接跳到第 2 輪。
 */
export function applyReviewSync(prev: MissionReview | undefined, snapshot: ReviewSyncSnapshot, now: number): MissionReview {
  const base: MissionReview = prev ?? { round: 1, roundStartedAt: now, discussions: [] }
  const isFirstSync = base.lastSyncAt === undefined
  const bumps = !isFirstSync && hasNewOtherNotes(base.discussions, snapshot.discussions)

  const sawFeedbackNow = snapshot.approved || snapshot.discussions.some(d => d.isFeedback && d.lastOtherNoteId !== undefined)
  const sawFeedback = base.sawFeedback === true || sawFeedbackNow

  return {
    round: bumps ? base.round + 1 : base.round,
    roundStartedAt: bumps ? now : base.roundStartedAt,
    lastSyncAt: now,
    mrState: snapshot.mrState,
    approved: snapshot.approved,
    sawFeedback,
    selfUsername: snapshot.selfUsername ?? base.selfUsername,
    localHead: base.localHead,
    remoteHead: base.remoteHead,
    discussions: snapshot.discussions,
  }
}

// ===== 本機回覆偵測（不用等同步） =====

/** 成功發出一則討論回覆就把那個討論記成「最後一則是自己」；討論還不在快取裡（還沒同步過）就補一筆新的。 */
export function markDiscussionRepliedLocally(review: MissionReview, discussionId: string): MissionReview {
  const exists = review.discussions.some(d => d.id === discussionId)
  const discussions: ReviewDiscussion[] = exists
    ? review.discussions.map(d => (d.id === discussionId ? { ...d, lastBySelf: true } : d))
    : [...review.discussions, { id: discussionId, isFeedback: true, resolved: false, lastBySelf: true }]
  return { ...review, discussions }
}

const GLAB_API_PATTERN = /\bglab\s+api\b/
const GLAB_API_DISCUSSION_NOTES_PATTERN = /\bmerge_requests\/(\d+)\/discussions\/([^/\s"']+)\/notes\b/
const GLAB_API_MR_PROJECT_PATTERN = /\bprojects\/(.+?)\/merge_requests\//
// -f／-F／--field 是既有的「附帶欄位」寫法；--raw-field／--input 是 glab api 另外兩種帶
// body 的寫法，一樣要認得，不然 raw-field 寫的回覆會被誤判成沒有在發文。
const FIELD_LIKE_FLAG_PATTERN = /(^|\s)(-[fF]\b|--field\b|--raw-field\b|--input\b)/
const METHOD_PREFIX = '--method='

/**
 * 把引號（單引號／雙引號）包起來的內容整段拿掉，只留引號外的部分——判斷「這個指令是不是
 * 真的在發文」只看指令本身的 flag，不看使用者打進 body 文字裡的字串；body 裡剛好寫了
 * 「用 -X PATCH」這種話不該被誤判成指令真的帶了 -X PATCH。
 */
function stripQuotedSegments(command: string): string {
  let result = ''
  let quote: '"' | "'" | null = null
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    result += ch
  }
  return result
}

/**
 * 把指令切成 shell 風格的 token：空白分隔，但引號內的空白不算分隔符（整段當一個
 * token，引號本身拿掉）。跟 stripQuotedSegments 不一樣的地方：這裡不會把引號內的內容
 * 整個抹掉，是保留在它原本所屬的那個 token 裡——`-X "POST"` 會切成兩個 token
 * `-X`、`POST`（方法本身是獨立 token，讀得到），但 `body="用 -X PATCH"` 永遠只會是
 * 一個 token（引號從 body= 中間開始，不會被空白切斷），裡面提到的 -X 不會被誤判成
 * 另一個獨立的 -X flag。
 */
function shellTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let quote: '"' | "'" | null = null
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current)
        current = ''
        inToken = false
      }
      continue
    }
    current += ch
    inToken = true
  }
  if (inToken) tokens.push(current)
  return tokens
}

/**
 * 從 token 裡找 -X／--method 的方法值：值本身可能是獨立的下一個 token（`-X POST`、
 * `-X "POST"`、`--method POST`），也可能黏在 --method= 後面（`--method=POST`、
 * `--method="POST"`，shellTokens 已經把這種寫法併成一個 token）。找不到就回 undefined，
 * 不是「指令裡完全沒有 -X／--method 這幾個字」，而是「沒有一個獨立 token 真的是這兩個
 * flag」——body 文字裡提到的 -X／--method 永遠只會是別的 token 的一部分，不會被當成這裡。
 */
function methodFromTokens(tokens: readonly string[]): string | undefined {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token === undefined) continue
    if (token === '-X' || token === '--method') return tokens[i + 1]
    if (token.startsWith(METHOD_PREFIX)) return token.slice(METHOD_PREFIX.length)
  }
  return undefined
}

/**
 * 這個 Bash 指令算不算「真的在發文」：有明確寫 -X／--method 就只認 POST（PUT／PATCH／
 * DELETE 都是在編輯或刪除既有 note，不算新回覆，即使同時帶了 -f 之類的欄位旗標也不算）；
 * 沒寫明確方法，才退回看有沒有帶欄位類旗標（glab api 預設方法是 GET，只有帶了要送出的
 * 欄位才會真的變成 POST）。方法值用 shellTokens 讀（連 `-X "POST"` 這種帶引號的寫法都
 * 讀得到），欄位旗標檢查則對去掉引號的版本做——兩者都不會被使用者回覆文字裡剛好提到
 * 「用 -X PATCH」這種話混淆，因為那永遠只是另一個 token 的一部分，不會被當成獨立的
 * -X flag。跟 products.ts 的 POST_FLAG_PATTERN 分開——那支給 matchesIssueNoteCommand
 * 共用，改了會連 issue 留言偵測一起變。
 */
export function glabReplyIsPost(command: string): boolean {
  const method = methodFromTokens(shellTokens(command))
  if (method !== undefined) return method.toUpperCase() === 'POST'
  return FIELD_LIKE_FLAG_PATTERN.test(stripQuotedSegments(command))
}

/**
 * Bash 指令是不是在對「這個任務的 MR」發討論回覆：glab api 打
 * merge_requests/<iid>/discussions/<id>/notes 且真的是在發文（見 glabReplyIsPost），
 * 不是 --dry-run，專案要是這個 repo 自己的。對到就回那個討論 id，否則回 undefined。
 * mr-note.sh（MR 層級留言，路徑沒有 /discussions/<id>/）跟 fe-code-review-reply
 * （只產文字、不發 API）都對不到這個 pattern，不算回覆。
 */
export function discussionReplyMatch(command: string, mrIid: string, ownProjectPath: string | undefined): string | undefined {
  if (!GLAB_API_PATTERN.test(command)) return undefined
  if (DRY_RUN_FLAG_PATTERN.test(command)) return undefined
  if (!glabReplyIsPost(command)) return undefined

  const match = GLAB_API_DISCUSSION_NOTES_PATTERN.exec(command)
  if (match?.[1] !== mrIid || match[2] === undefined) return undefined
  if (!matchesOwnProject(GLAB_API_MR_PROJECT_PATTERN.exec(command)?.[1], ownProjectPath)) return undefined
  return match[2]
}

// ===== MR iid（從 open-mr 的 product 事件拿，退回資產清單） =====

/** 這個任務目前已知的 MR iid：open-mr 的 product 事件裡最新一筆帶 mrIid 的那筆。 */
export function latestMrIid(mission: Mission): string | undefined {
  const matches = mission.events.filter(event => event.kind === 'product' && event.name === 'mr' && event.mrIid !== undefined)
  return matches.at(-1)?.mrIid
}

/**
 * mr 事件沒帶 mrIid（這個欄位加進來之前記錄的舊任務）就退回資產清單：取最新一筆、分類
 * 是這個專案自己的 MR 網址，解析出它的 iid。開 MR 當時的 Bash stdout 本來就會被
 * looksLikeMrCommand 收進 assets（見 register.tsx），舊任務一樣有這份資料，只是沒有
 * mrIid 欄位。ownProjectPath 是 undefined（讀不到專案路徑）就不猜，寧可回 undefined
 * 也不要誤認別的專案的 MR。
 */
export function resolveMrIid(mission: Mission, ownProjectPath: string | undefined): string | undefined {
  const fromEvent = latestMrIid(mission)
  if (fromEvent !== undefined) return fromEvent
  if (ownProjectPath === undefined) return undefined

  const candidates = missionAssets(mission).filter(asset => classifyUrl(asset.url) === 'gitlab-mr' && gitlabProjectPath(asset.url) === ownProjectPath)
  const latest = candidates.reduce<(typeof candidates)[number] | undefined>((best, asset) => (best === undefined || asset.at > best.at ? asset : best), undefined)
  return latest === undefined ? undefined : gitlabIid(latest.url)
}

// ===== glab api 回應解析 =====

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** GitLab MR 的 state 欄位；locked 併入 opened（還沒合併也沒關閉，流程上視為一樣）。 */
export function mrStateFrom(json: unknown): 'opened' | 'merged' | 'closed' | undefined {
  const state = asRecord(json)?.state
  if (state === 'merged') return 'merged'
  if (state === 'closed') return 'closed'
  if (state === 'opened' || state === 'locked') return 'opened'
  return undefined
}

/**
 * approvals 端點的 `approved` 布林不能信：approvals_required 設成 0 時，GitLab 回
 * approved:true，即使根本沒有人核准過。一律只看 `approved_by` 是不是非空陣列。
 */
export function approvedFrom(json: unknown): boolean {
  const approvedBy = asRecord(json)?.approved_by
  return Array.isArray(approvedBy) && approvedBy.length > 0
}

/** `glab api user` 回應裡的 username；格式不對就回 undefined，呼叫端自己決定要不要重試。 */
export function usernameFrom(json: unknown): string | undefined {
  const username = asRecord(json)?.username
  return typeof username === 'string' ? username : undefined
}

// ===== doneWhen：審查階段五個節點 =====

/** await-review：一旦同步到別人的回饋或已核准就是 done，之後不會變回未完成（sawFeedback 是 sticky 旗標）。 */
export function evaluateAwaitReviewDoneWhen(mission: Mission): DoneWhenResult {
  return { done: mission.review?.sawFeedback === true }
}

/** approved：看最後一次同步的即時狀態，不是 sticky——推新 commit 後 GitLab 會清掉核准，下次同步就退回未完成。 */
export function evaluateApprovedDoneWhen(mission: Mission): DoneWhenResult {
  return { done: mission.review?.approved === true }
}

/**
 * reply：每則回饋討論都 resolved，或最後一則是自己留的，才算完成；沒有待回的討論（含直接
 * approve）也算完成。還沒同步過（lastSyncAt undefined）一律不算完成——沒有討論資料不代表
 * 真的沒有回饋，只是還沒問過 GitLab，不能當「沒事可回」。
 */
export function evaluateReplyDoneWhen(mission: Mission): DoneWhenResult {
  if (mission.review?.lastSyncAt === undefined) return { done: false }
  const pending = mission.review.discussions.filter(d => d.isFeedback && !d.resolved && !d.lastBySelf)
  return { done: pending.length === 0, detail: pending.length > 0 ? `${pending.length} 則待回` : undefined }
}

/** push-fix：本機 HEAD 跟遠端分支 HEAD 一樣才算完成（見 hooks/review-events.ts 怎麼查這兩個欄位）。 */
export function evaluatePushFixDoneWhen(mission: Mission): DoneWhenResult {
  const { localHead, remoteHead } = mission.review ?? {}
  if (localHead === undefined) return { done: false }
  if (remoteHead === undefined) return { done: false, detail: '讀不到遠端分支' }
  return { done: localHead === remoteHead, detail: localHead === remoteHead ? undefined : '還沒 push' }
}

const VERIFY_STAGE_SKIPPED_REASON = '驗收階段已跳過整體回歸'
const NO_CHECKLIST_SKIP_REASON = '沒有驗收清單，不用重驗'

/**
 * reverify 節點要不要自動顯示成已跳過：驗收階段的整體回歸被 /mission-skip 過
 * （mission.skips 裡有 overall-regression），或這個任務根本沒有驗收清單（沒跑過
 * /to-acceptance），這兩種情況都沒有基準可比，顯示成「已跳過」比「還沒開始」準確。
 * 其餘情況（清單存在、整體回歸沒被跳過）一律正常顯示——不管目前記錄的狀態是通過、
 * 未過、受阻還是未跑：重跑 /verify-acceptance 把結果改成未過之後，這個節點不該憑空
 * 消失，使用者才看得到「還沒重驗過」這件事（見 evaluateReverifyDoneWhen）。
 */
export function reverifySkipReason(mission: Mission): string | undefined {
  // 審查途中清單檔被歸檔或搬走，下次刷新會把 acceptance.exists 變成 false，但只要還留著
  // 之前讀到的 overall 紀錄，就不當成「沒有驗收清單」——那份紀錄還能拿來比對，不該讓節點
  // 憑空消失。只有真的從來沒有 overall 紀錄（從沒跑過 /to-acceptance，或清單本身就沒有
  // 「整體回歸」那一行）才算沒有清單。
  if (mission.acceptance?.overall === undefined) return NO_CHECKLIST_SKIP_REASON
  if ('overall-regression' in mission.skips) return VERIFY_STAGE_SKIPPED_REASON
  return undefined
}

/**
 * reverify：驗收清單記的整體回歸是不是「通過」，而且記的 sha 跟目前本機 HEAD 一樣——
 * 看現狀不看輪次，rebase／改完 code 之後 HEAD 變了就是沒重驗過，不管這個變動是哪一輪
 * 造成的。sha 比對沿用 acceptance-events.ts 的 shaDiffers（跟驗收階段 overall-regression
 * 節點判斷「過期」用同一套規則），不是嚴格全等：清單可能記著縮寫版 sha（≥7 字元就信任，
 * 用 head.startsWith() 比對），同一份清單在兩個階段不該因為比對方式不同而給出不同答案。
 * 狀態不是「通過」（未跑／未過／受阻）、沒有 sha、或還沒查到本機 HEAD，都算沒驗過；這個
 * 節點什麼時候整個不出現（已跳過）由 reverifySkipReason 決定，跟這裡的完成判斷是兩件事。
 */
export function evaluateReverifyDoneWhen(mission: Mission): DoneWhenResult {
  const overall = mission.acceptance?.overall
  const localHead = mission.review?.localHead
  if (overall?.status !== '通過' || overall.sha === undefined || localHead === undefined) return { done: false }
  const done = !shaDiffers(overall.sha, localHead)
  return { done, detail: done ? undefined : 'commit 變了' }
}
