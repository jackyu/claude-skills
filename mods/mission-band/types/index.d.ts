export type NodeId = string

/**
 * 節點完成的條件，取代預設的「同階段更晚的節點也開始了」規則：
 * commit 看 branchCommits，mr／issue-note 看對應的 product 事件，acceptance-file 看
 * mission.acceptance.exists（見 hooks/acceptance.ts 的 evaluateAcceptanceDoneWhen）。
 * acceptance-run／regression-write／overall-regression 是驗收階段的三個節點，都看
 * mission.acceptance 裡對應的欄位（見 hooks/acceptance.ts 的三個 evaluate*DoneWhen）。
 */
export type DoneWhen =
  | 'commit'
  | 'mr'
  | 'issue-note'
  | 'worktree'
  | 'acceptance-file'
  | 'acceptance-run'
  | 'regression-write'
  | 'overall-regression'
  | 'await-review'
  | 'review-triage'
  | 'reverify'
  | 'push-fix'
  | 'reply'
  | 'approved'

/**
 * 怎麼把一個事件比對成「這個節點／軌道開始了」，節點（MissionFlowNode）跟軌道
 * （MissionFlowTrack）共用同一組欄位。matchSkill 比對時會先把事件名稱的 plugin 前綴去掉
 * （見 hooks/node-states.ts 的 stripPluginPrefix）；可以給單一名稱或陣列。matchSkillPrefix
 * 比對前綴（例如 'verify-' 比對 verify-admin／verify-client）。matchAgentPrefix 比對 Agent
 * 工具呼叫的 subagent_type 前綴（不去掉前綴，例如 'codex:' 比對 'codex:codex-rescue'）。
 * matchSkillExact 比對事件的完整原始名稱（含 plugin 前綴，不去掉），用在名稱本身就帶著辨識用
 * 前綴的場合（例如只認 'codex:rescue'，不要任何前綴的 'rescue' 都算）。matchBash 比對
 * kind 'bash' 事件的 name（見 hooks/products.ts 從 Bash 指令本身判斷出的動作名稱，例如
 * 'codex review'／'codex exec'），可以給單一名稱或陣列。
 */
export type EventMatcher = {
  matchSkill?: string | readonly string[]
  matchSkillPrefix?: string
  matchSkillExact?: string
  matchRead?: string
  matchAgentPrefix?: string
  matchBash?: string | readonly string[]
}

/**
 * 雙軌節點（目前只有 code-review）底下的一條審查軌：自己的事件比對條件、沒跑完時的提示文字。
 * legacySkipIds 是這條軌道在合併成雙軌節點之前、曾經是獨立節點時的 id——舊資料用那個 id 當 key
 * 跳過時（`mission.skips[legacySkipId]`），等同這條軌道被跳過，不用重新審一次。
 */
export type MissionFlowTrack = EventMatcher & {
  id: string
  label: string
  hint: string
  legacySkipIds?: readonly string[]
}

/**
 * 流程裡的一個節點：怎麼比對事件、要不要顯示提示。
 * 沒給 doneWhen 就沿用預設規則：自己開始了，且同階段更晚的節點也開始（或都已跳過／是從沒開始過
 * 的 optional 節點）才算完成。有 tracks 的節點（例如 code-review）不吃上面這兩種規則，也不吃
 * EventMatcher 自己的欄位——完成條件完全由各軌道的狀態決定（見 hooks/node-states.ts 的
 * tracksNodeStatus）：至少一條軌道真的跑過，且其餘軌道都跑過或被跳過，才算完成。
 * label：band 顯示用的文字，沒給就顯示 id（大多數節點 id 本身就是給人看的，例如
 * to-acceptance；少數節點 id 跟顯示文字該分開，例如 acceptance-run 顯示「逐條驗收」，
 * id 還是 acceptance-run 以便 /mission-skip 跟事件比對用）。
 * hint 可以是固定字串，也可以是一個看任務當下狀態決定提示文字的函式（例如 acceptance-run
 * 的提示要看驗收清單存不存在而不同）；見 hooks/node-states.ts 的 resolveNodeHint。
 */
/**
 * skipWhen：這個節點要不要「自動」顯示成已跳過（不是使用者打 /mission-skip）；回傳跳過
 * 原因就顯示成 skip（跟 /mission-skip 一樣的 ✗ 樣式，原因文字用 state.detail 顯示），
 * 回 undefined 就照一般規則判斷。目前只有 reverify 用到：驗收階段的整體回歸被跳過、或
 * 根本沒有驗收清單，這個節點就沒有基準可比——顯示成「已跳過」比「還沒開始」準確，不會
 * 卡在一個使用者做不到的動作上，也不會在改回「未過」之類的狀態時整個消失不見（見
 * hooks/review-stage.ts 的 reverifySkipReason）。
 */
export type MissionFlowNode = EventMatcher & {
  id: NodeId
  label?: string
  optional?: true
  doneWhen?: DoneWhen
  tracks?: readonly MissionFlowTrack[]
  hint: string | ((mission: Mission) => string)
  skipWhen?: (mission: Mission) => string | undefined
}

export type MissionStage = {
  id: string
  label: string
  nodes: readonly MissionFlowNode[]
}

export type MissionFlow = {
  name: 'new-feature'
  stages: readonly MissionStage[]
}

export type MissionEventKind = 'skill' | 'read' | 'product' | 'agent' | 'bash'

export type MissionEvent = {
  at: number
  kind: MissionEventKind
  // skill 事件存完整名稱（含 plugin 前綴，例如 mattpocock-skills:grilling）；
  // read 事件存 pstack:<skill> 或 playbook:<name>；product 事件存 'mr' 或 'issue-note'；
  // agent 事件存 Agent 工具呼叫的 subagent_type（例如 codex:codex-rescue）；
  // bash 事件存從 Bash 指令本身判斷出的動作名稱（例如 'codex review'／'codex exec'）。
  name: string
  agentId?: string
  // 只有 kind 'mr' 的 product 事件會帶：MR 描述缺的段落，沒缺就是空陣列。
  missingSections?: readonly string[]
  // 只有 kind 'mr' 的 product 事件會帶：驗收清單裡（非已刪除的）AC id，在 MR 描述的
  // Evidence 段落裡完全沒提到的那些；沒有驗收清單或沒缺就是空陣列。
  missingAcs?: readonly string[]
  // 只有 kind 'mr' 的 product 事件會帶：這次開或改的 MR iid，/mission-review 同步要用
  // 這個 iid 打 glab api（見 hooks/review-stage.ts 的 latestMrIid）。
  mrIid?: string
  // 只有 kind 'product' name 'review-sync' 的事件會帶：這次同步算出來的輪次，
  // 讓 /mission-log 看得到歷史輪次（見 hooks/reporting.ts）。
  round?: number
}

/** 分支上領先預設分支的一顆 commit；at 是 commit 時間（毫秒）。 */
export type BranchCommit = { hash: string; at: number }

export type MissionAssetSource = 'issue' | 'prompt' | 'tool' | 'manual'

/** 資產清單裡的一筆連結；label 是顯示用的短標籤，網址可以點開。 */
export type MissionAsset = {
  url: string
  label: string
  description: string
  source: MissionAssetSource
  at: number
}

export type Mission = {
  name: string
  flow: 'new-feature'
  binding: string
  createdAt: number
  stage: number
  skips: Record<NodeId, string>
  events: MissionEvent[]
  // 第二版才加的欄位，第一版寫入的舊資料沒有這個 key；讀的時候要當空陣列。
  assets?: MissionAsset[]
  // 第三版才加的欄位：每個階段進入的時間（index 對應 flow.stages 的 index）。
  // 舊資料沒有這個欄位，或缺某個 index，都當作 createdAt（見 hooks/model.ts 的 stageEnteredAt）。
  stageEnteredAt?: number[]
  // 目前分支領先預設分支的 commit 清單，每次 Bash 或 turn 結束後整包覆蓋；沒有就當空陣列。
  branchCommits?: readonly BranchCommit[]
  // 第四版才加的欄位：這個任務在跑的 worktree 絕對路徑，從 orca／git worktree 指令或
  // cd 進 worktree 目錄偵測出來；舊資料沒有這個欄位，當作沒有 worktree（在主 checkout 分析中）。
  worktreePath?: string
  // 第五版才加的欄位：驗收清單（acceptance-<key>.md）讀進來的精簡摘要；舊資料沒有這個欄位，
  // 當作還沒讀過（exists 當 false），見 hooks/acceptance.ts 的 evaluateAcceptanceDoneWhen。
  acceptance?: MissionAcceptance
  // 第七版才加的欄位：審查階段的同步狀態與輪次；進入審查階段時才初始化（見 hooks/model.ts
  // 的 nextStage），離開審查階段之後還留著（/mission-log 看歷史），舊任務或還沒進審查的
  // 任務當作 undefined，見 hooks/review-stage.ts 的各個 evaluate*DoneWhen。
  review?: MissionReview
  // 第八版才加的欄位：用過這個任務的 session id（/clear 之後會換新的），/mission-cost 靠它找
  // transcript；舊資料沒有這個欄位，當作空陣列。
  sessionIds?: string[]
  // 第九版才加的欄位：`/review-triage` 寫在 `<main>/.claude/verify-evidence/<key>/
  // review-triage-r<N>.md` 的報告，讀進來的精簡 meta 清單（見 hooks/review-triage.ts 的
  // parseReviewTriageMeta）；離開審查階段還留著，舊任務或還沒跑過 `/review-triage` 的任務
  // 當作沒有報告。
  reviewTriage?: MissionReviewTriage
}

// ===== 審查階段（/mission-review 同步狀態）=====

/** 單一討論（GitLab discussion）同步後的精簡狀態，見 hooks/review-stage.ts 的 classifyDiscussion。 */
export type ReviewDiscussion = {
  id: string
  // 是不是算「回饋討論」：排除閱讀地圖導覽註解（第一則 🤖💬 開頭、含自我標記、沒有別人回覆）；
  // 其餘（含自己留的提醒）都算，用標記判斷不用作者判斷。
  isFeedback: boolean
  // 討論裡可解決的 note 是不是都解決了；沒有任何可解決的 note 就算 false（靠 lastBySelf 判斷完成）。
  resolved: boolean
  // 最後一則是不是自己發的；reply 節點看這個欄位，不用等下次同步。
  lastBySelf: boolean
  // 別人發的 note 裡最大的 note id（GitLab note id 全站單調遞增，不是每個討論自己一組）；
  // 沒有別人發過就是 undefined。輪次判斷跟 sawFeedback 都比這個，不比時間戳——GitLab 的
  // created_at 是伺服器時間，本機時鐘跟它對不齊，見 hooks/review-stage.ts 的 applyReviewSync。
  lastOtherNoteId?: number
}

/**
 * 審查階段的同步狀態；進入審查階段時建立（round 1，lastSyncAt 還沒寫），每次
 * /mission-review 同步覆蓋。sawFeedback、discussions 都是整份覆蓋（不是累加），
 * round／roundStartedAt／sawFeedback 是跨同步累積的欄位，見 hooks/review-stage.ts 的
 * applyReviewSync。reverify／push-fix 看現狀（驗收清單的 sha／本機遠端 HEAD），不看輪次。
 */
export type MissionReview = {
  round: number
  roundStartedAt: number
  lastSyncAt?: number
  mrState?: 'opened' | 'merged' | 'closed'
  approved?: boolean
  // 是不是已經同步到至少一次別人的回饋（或已核准）；一旦 true 就不會變回 false
  // （await-review 節點靠這個判斷「開始被審」，核准後又推 commit 不影響這個旗標）。
  sawFeedback?: boolean
  selfUsername?: string
  // 本機 git 查到的 HEAD／遠端上游（`@{u}`）HEAD（見 hooks/review-events.ts 的
  // maybeRefreshReviewHeads）；push-fix 節點比較這兩個欄位，reverify 節點比較 localHead
  // 跟驗收清單記的整體回歸 sha。
  localHead?: string
  remoteHead?: string
  discussions: readonly ReviewDiscussion[]
}

// ===== 驗收清單（acceptance-<key>.md）=====
// 格式契約見 claude-skills/skills/_shared/acceptance/format.md；解析層在 hooks/acceptance.ts。

export type AcceptanceItemStatus = '待驗' | '通過' | '未過' | '受阻' | '待重驗' | '已刪除'
export type AcceptanceOverallStatus = '未跑' | '通過' | '未過' | '受阻'
export type AcceptanceApp = 'admin' | 'client' | 'both'
export type AcceptanceBranchType = 'feat' | 'bug' | 'fix'
/** 「驗不了時」欄的值；缺這欄或值認不得都當 `必須驗過`。只有「受阻＋可後補」才不擋逐條驗收節點。 */
export type AcceptanceDeferrability = '必須驗過' | '可後補' | '只驗前端'

/** `<!-- acceptance:meta {...} -->` 解析出來的欄位；JSON 壞掉或缺欄位都容忍，當空物件。 */
export type AcceptanceMeta = {
  key?: string
  mission?: string
  branch?: string
  spec?: string | null
  specMtime?: string
  app?: AcceptanceApp
  branchType?: AcceptanceBranchType
}

/**
 * 單一 AC 項目；fields 原樣保留解析到的欄位（含「結果」本身），status 是從「結果」欄算出的狀態。
 * needsBefore：改動前既不是「無（新功能）」、也不是「同預期」開頭，才需要補 Before 證據；
 * 第二、三期（verify-acceptance／fe-mr-generator）才會用到。
 */
export type AcceptanceItem = {
  id: string
  deleted: boolean
  title: string
  fields: Readonly<Record<string, string>>
  status: AcceptanceItemStatus
  deferrability: AcceptanceDeferrability
  needsBefore: boolean
}

export type AcceptanceCounts = {
  total: number
  passed: number
  failed: number
  blocked: number
  pending: number
  // 第七版才加：受阻裡「可後補」的那些，不擋逐條驗收節點。舊資料（存進 $.store 時還沒有
  // 這欄）型別上容忍缺漏，讀的地方都要把 undefined 當 0。
  deferred?: number
  regressionTodo: number
  regressionTotal: number
}

export type AcceptanceOverall = {
  status: AcceptanceOverallStatus
  /** 只有 status 是「通過」時才有，解析自 `通過｜<ISO>｜<sha>｜<n>`。 */
  sha?: string
}

export type AcceptanceSummary = {
  meta: AcceptanceMeta
  items: readonly AcceptanceItem[]
  counts: AcceptanceCounts
  overall: AcceptanceOverall
}

/**
 * mission-band 讀驗收清單後存在任務上的精簡摘要；只留後面階段會用到的欄位，不整份塞進
 * $.store（見 hooks/acceptance-events.ts 的 maybeRefreshAcceptance）。
 */
export type MissionAcceptance = {
  exists: boolean
  counts?: AcceptanceCounts
  overall?: AcceptanceOverall
  metaSpec?: string | null
  metaSpecMtime?: string
  // 掃 .claude/specs 配到的檔案絕對路徑（任務名沒有 #<數字> 才會用到）；下次刷新先試
  // 這個路徑，meta.mission 還對得上就不用重新掃整個目錄，見 acceptance-events.ts 的
  // tryCachedPath。任務名有 #<數字> 時路徑是直接拼出來的，存這裡純粹順便，不影響判斷。
  resolvedPath?: string
  // 讀檔失敗（檔案存在但讀不到，例如權限問題）時記下的錯誤訊息；同一個訊息已經記過
  // 就不再 $.ui.log 第二次，避免持續性的失敗每個 turn 都洗一次 log（見
  // acceptance-events.ts 的 maybeRefreshAcceptance）。成功刷新一次就會清掉。
  lastReadError?: string
  // 第六版才加的三個欄位（驗收階段用）：
  // specStale：meta.spec 現在的 mtime 比 meta.specMtime 晚（見 acceptance.ts 的
  // isSpecStale），band 顯示「規格改過了」的黃色提示列用這個欄位。
  specStale?: boolean
  // overallStale：整體回歸記錄的 sha 跟 worktree 現在的 HEAD 不一樣；只有 overall.status
  // 是「通過」、任務有 worktreePath 時才會去查，查不到（git 失敗）就當作沒有過期，
  // 跟 maybeUpdateBranchCommits 查不到 commit 時不清空既有快照的保守做法一致。
  overallStale?: boolean
  // acIds：驗收清單裡（非已刪除的）AC id 清單，open-mr 節點檢查 MR 描述的 Evidence
  // 段落有沒有漏提到哪個 AC 時要用；存這裡省得開 MR 那一刻還要重讀一次清單檔。
  acIds?: readonly string[]
  readAt: number
}

// ===== review-triage 報告（<main>/.claude/verify-evidence/<key>/review-triage-r<N>.md）=====
// 報告格式契約見 skills/review-triage/SKILL.md 的 Step 6；解析層在 hooks/review-triage.ts。

/** review-triage 報告 meta 的 counts 欄位：確認／待驗證／撤銷／防禦性建議／質疑前提各幾筆。 */
export type ReviewTriageCounts = {
  confirmed: number
  pending: number
  withdrawn: number
  defensive: number
  premise: number
}

/**
 * 報告第一行 `<!-- review-triage: {...} -->` 解析出來的精簡資料（見 hooks/review-triage.ts
 * 的 parseReviewTriageMeta）。notes 是這份報告判定涵蓋的 GitLab note id；來源是 reviewer 時
 * 列出全部 note id（含分類成提問、風格的），來源是 ai-review 時是空陣列。
 */
export type ReviewTriageReportMeta = {
  round: number
  head: string
  notes: readonly number[]
  counts: ReviewTriageCounts
  warn: boolean
}

/**
 * mission-band 讀到的 review-triage 報告清單（見 hooks/review-triage-events.ts 的
 * maybeRefreshReviewTriage）；只存每份報告第一行解析出的 meta，不存報告全文。
 */
export type MissionReviewTriage = {
  reports: readonly ReviewTriageReportMeta[]
  // 單份報告格式不對（解析失敗）時記的訊息，只在跟上次不同才重新 $.ui.log，
  // 跟 MissionAcceptance.lastReadError 同一套邏輯。
  lastReadError?: string
}

export type Missions = Record<string, Mission>

declare module 'claude-code' {
  interface PluginState {
    'mission-band': { missions: Missions; progressContext: { sessionId: string | null; text: string | null; pending: string | null } }
  }
}
