// band 的版面：只決定「該畫什麼」，回傳結構化的資料（segments），不產生畫面本身；
// register.tsx 的 ui.render 負責把每個 segment 轉成 Text 或 Link。
import type { Mission, MissionFlow } from '../types'
import { descriptionFor, displayedAssets } from './assets'
import { nextStepHint, nodeStates, REVIEW_STAGE_ID, stageAt, stageLabelFor, ticketsChangedSinceBuild, type NodeState, type NodeStatus } from './model'
// isBlocking 沒有被 model.ts 重新 export（那裡只內部用），直接從 node-states.ts 拿；
// node-states.ts 沒有反過來 import band.ts，不會繞出循環依賴。
import { displayName, isBlocking } from './node-states'

const NARROW_COLUMNS = 60
const WIDE_COLUMNS = 100
const MAX_BAND_ROWS = 13
const MAX_INNER_ROWS = 8
// 框線上下各 1 行＋標題 1 行＋tabs 1 行＋下一步 1 行＝固定佔掉 5 行，剩下才是框內能放的列數；
// 票數變動、規格改過、連續輪次這幾種提示各多佔 1 行，見 bandPlan 的 fixedRows。「上次同步」
// 不算在這裡——它是 tabs 列自己的後綴，不是獨立的一列。
const FIXED_ROWS = 5
// register.tsx 在 tabs 列最右側畫一顆「?」說明按鈕（plain + hotkey「h」+ 一個字的 label，
// 畫出來是固定 4 格的「h: ?」），narrow 模式才會不放。這裡不畫按鈕本身，但算「上次同步」
// 後綴塞不塞得下時要先扣掉這塊——按鈕一定要留位置，寧可先丟後綴，不要把按鈕擠出框外。
const HELP_BUTTON_WIDTH = 4
const TICKETS_CHANGED_TEXT = '票數有變動，檢查 issue 描述要不要同步'
const SPEC_STALE_TEXT = '規格改過了，檢查驗收清單要不要更新'
// Link 不會換行，標籤跟說明太長就截斷＋…，避免被終端機硬擠斷行。
const MAX_STEP_TEXT_LENGTH = 38
const MAX_ASSET_LABEL_LENGTH = 30
const MAX_ASSET_DESCRIPTION_LENGTH = 8

// width 給固定寬度的欄位用（步驟符號、資產列點），同一欄每一列都對齊，符號長度不同也不會跳動。
export type BandSegment = { text: string; color?: string; bold?: true; dim?: true; href?: string; width?: number }
export type BandRow = { key: string; segments: BandSegment[] }

export type BandPlan =
  | { mode: 'narrow'; line: string }
  | { mode: 'steps-only'; tabs: BandRow; warnings: readonly BandRow[]; steps: BandRow[]; next: BandRow }
  | { mode: 'two-box'; tabs: BandRow; warnings: readonly BandRow[]; steps: BandRow[]; assets: BandRow[]; next: BandRow }

const STEP_SYMBOL: Record<NodeStatus, string> = {
  'not-started': '○',
  started: '▶',
  done: '✓',
  skip: '✗',
}

// 先用 theme key（success／error／warning），終端機顯示不對再改成原始顏色。
const STEP_COLOR: Partial<Record<NodeStatus, string>> = {
  started: 'warning',
  done: 'success',
  skip: 'error',
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** 標題文字：有專案名稱就是「<專案> > <任務名>」，沒有就只顯示任務名。 */
function titleText(mission: Mission, projectName: string | undefined): string {
  return projectName === undefined ? mission.name : `${projectName} > ${mission.name}`
}

// 整行要塞進多窄的視窗都裁不出正確寬度（中文字一個字佔兩個 cell，用字數切會算錯），
// 這裡只回傳完整文字，裁切交給 register.tsx 用 Text 的 wrap="truncate-end" 處理。
function narrowLine(mission: Mission, flow: MissionFlow, projectName: string | undefined, warningTexts: readonly string[]): string {
  const stage = stageAt(flow, mission.stage)
  const states = nodeStates(stage.nodes, mission)
  const hint = nextStepHint(flow, mission)
  const done = states.filter(s => s.status === 'done' || s.status === 'skip').length
  const suffix = warningTexts.map(text => `｜⚠ ${text}`).join('')
  return `${titleText(mission, projectName)}｜${stageLabelFor(stage, mission)} ${done}/${states.length}｜${hint}${suffix}`
}

/** 標題（任務名，可加專案名稱）＋分隔線＋ tabs 三態：已過的階段 ✓ 綠、目前階段 ● 白粗體、還沒到的階段 ○ 變暗。 */
function tabsRow(flow: MissionFlow, mission: Mission, projectName: string | undefined): BandRow {
  const title: BandSegment = { text: titleText(mission, projectName), bold: true }
  const separator: BandSegment = { text: '｜', dim: true }
  const stageSegments = flow.stages.map((stage, i) => {
    if (i < mission.stage) return { text: `✓ ${stage.label}`, color: 'success' }
    if (i === mission.stage) return { text: `● ${stageLabelFor(stage, mission)}`, bold: true as const }
    return { text: `○ ${stage.label}`, dim: true as const }
  })
  return { key: 'tabs', segments: [title, separator, ...stageSegments] }
}

// CJK 統一表意文字／假名／全形符號與全形字母數字佔 2 格，其餘（含 ASCII、符號 ●／✓／○）
// 當 1 格——只是用來估「加這個後綴會不會讓 tabs 這一列超寬」，不求對到每一種 unicode 寬字元。
const WIDE_CHAR_PATTERN = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/

function textWidth(text: string): number {
  let width = 0
  for (const ch of text) width += WIDE_CHAR_PATTERN.test(ch) ? 2 : 1
  return width
}

/** 一整列的估計寬度：每個 segment 自己的文字寬度，加上 register.tsx 畫的時候 segment 之間那個 gap={1}。 */
function rowWidth(row: BandRow): number {
  const gaps = Math.max(0, row.segments.length - 1)
  return row.segments.reduce((sum, segment) => sum + textWidth(segment.text), 0) + gaps
}

/**
 * 「上次同步 X 前」接在 tabs 列最後面，當一個單獨的 dim 後綴 segment；加上去會讓整列超過
 * bodyColumns 就整個不加——寧可少顯示這一行資訊，也不要讓終端機把 tabs 這一列擠成兩行
 * （那樣會打亂框內其他列的高度預算，而且使用者在這個 mod 裡滑不動，看不到被擠掉的部分）。
 */
function withSyncSuffix(tabs: BandRow, suffixText: string | undefined, bodyColumns: number): BandRow {
  if (suffixText === undefined) return tabs
  const candidate: BandRow = { key: tabs.key, segments: [...tabs.segments, { text: suffixText, dim: true }] }
  return rowWidth(candidate) <= bodyColumns ? candidate : tabs
}

// symbol 固定寬度 2，label 文字長度不同也不會把後面的欄位擠歪。
// 跳過的原因優先顯示：使用者打 /mission-skip 的那句留在 mission.skips，自動跳過
// （node.skipWhen）的原因留在 state.detail，兩者都沒有才看一般 doneWhen 的 detail
// （commit 數、MR 缺的段落）。
function stepRow(state: NodeState, mission: Mission): BandRow {
  const symbol = STEP_SYMBOL[state.status]
  const name = displayName(state.node)
  const suffix = state.status === 'skip' ? mission.skips[state.node.id] ?? state.detail : state.detail
  const label = truncateText(suffix === undefined ? name : `${name}（${suffix}）`, MAX_STEP_TEXT_LENGTH)
  const color = STEP_COLOR[state.status]
  const symbolSegment: BandSegment = color === undefined ? { text: symbol, dim: true, width: 2 } : { text: symbol, color, width: 2 }
  const labelSegment: BandSegment = color === undefined ? { text: label, dim: true } : { text: label, color }
  return { key: state.node.id, segments: [symbolSegment, labelSegment] }
}

// 說明文字一律用 descriptionFor(asset.url) 現場算，不用存起來的 asset.description——
// 舊版寫入的資產也要跟著脫離舊格式（帶專案短名），不用等重新收集。
function assetRow(asset: ReturnType<typeof displayedAssets>[number]): BandRow {
  return {
    key: asset.label,
    segments: [
      { text: '•', dim: true, width: 2 },
      { text: truncateText(asset.label, MAX_ASSET_LABEL_LENGTH), href: asset.url },
      { text: truncateText(descriptionFor(asset.url), MAX_ASSET_DESCRIPTION_LENGTH), dim: true },
    ],
  }
}

/** 超過框內能放的列數時，留夠的列數再補一行「另有 N 列」；永遠不超過 maxInnerRows。 */
function truncateRows(rows: BandRow[], maxInnerRows: number): BandRow[] {
  if (rows.length <= maxInnerRows) return rows
  if (maxInnerRows <= 0) return []
  const shown = rows.slice(0, maxInnerRows - 1)
  const hidden = rows.length - shown.length
  return [...shown, { key: 'more', segments: [{ text: `另有 ${hidden} 列`, dim: true }] }]
}

// 收合門檻：leading run 不到 2 個就不值得換成一行摘要（1 換 1 沒有省到位子，還少了
// 原本那個節點自己的狀態細節）。
const COLLAPSE_MIN_RUN = 2

/**
 * 從第 0 個節點開始、連續不中斷「不擋路」（isBlocking 為 false：done、skip，或從沒
 * 開始過的 optional）的節點數；中間一碰到會擋路的節點就停手——那就是目前卡住的節點，
 * 一定要留著，不能被收合，也不能被尾端截斷吞掉。
 *
 * 不能只看 done／skip：optional 節點從沒開始過也不擋路（例如 prototype／to-tickets），
 * 混在 leading run 中間一樣該算進去，不然 leading run 會在它們那裡被誤判成「斷了」，
 * 後面真正卡住的節點反而因為 run 太短、沒收合，被尾端截斷擠進「另有 N 列」。
 */
function leadingNonBlockingCount(states: readonly NodeState[]): number {
  let count = 0
  for (const state of states) {
    if (isBlocking(state)) break
    count += 1
  }
  return count
}

function collapsedLeadingRow(count: number): BandRow {
  const label = truncateText(`前面 ${count} 項已完成或略過`, MAX_STEP_TEXT_LENGTH)
  return { key: 'collapsed', segments: [{ text: '✓', color: 'success', width: 2 }, { text: label, color: 'success' }] }
}

/**
 * 塞不下時的尾端截斷，但保證 keepIndex 那一列一定在留下來的範圍內：優先保留 keepIndex
 * 之前（含自己）的部分，budget 不夠放完前面全部時才往前犧牲（讓 keepIndex 落在視窗
 * 最後一列）；keepIndex 之後還有剩餘預算才拿去放後面的列——等於「要犧牲就先犧牲
 * keepIndex 後面的列」。
 *
 * collapsedCount 有給值，代表 rows[0] 是收合摘要列，實際代表那麼多個真實節點（不是
 * 1 列＝1 個節點）；這一列如果也被擠掉，「另有」要還原成真實節點數才不會報小——改用
 * 「另有 N 項」的講法跟一般「另有 N 列」區分開來。只放得下 keepIndex 自己 1 列時
 * （available<=0）直接回傳那一列，不加任何「另有」——放不下摘要文字，不如什麼都不講。
 */
function truncateKeepingIndex(rows: readonly BandRow[], maxInnerRows: number, keepIndex: number, collapsedCount?: number): BandRow[] {
  if (rows.length <= maxInnerRows) return [...rows]
  if (maxInnerRows <= 0) return []

  const available = maxInnerRows - 1
  if (available <= 0) {
    const current = rows[keepIndex] ?? rows[0]
    return current === undefined ? [] : [current]
  }

  const prefixLen = Math.min(keepIndex + 1, available)
  const prefixStart = keepIndex + 1 - prefixLen
  const prefix = rows.slice(prefixStart, keepIndex + 1)
  const tailBudget = available - prefix.length
  const tail = tailBudget > 0 ? rows.slice(keepIndex + 1, keepIndex + 1 + tailBudget) : []
  const shown = [...prefix, ...tail]
  const hiddenRows = rows.length - shown.length

  const collapsedRowHidden = collapsedCount !== undefined && prefixStart > 0
  const hiddenCount = collapsedRowHidden ? hiddenRows - 1 + collapsedCount : hiddenRows
  const hiddenLabel = collapsedRowHidden ? `另有 ${hiddenCount} 項` : `另有 ${hiddenCount} 列`
  return [...shown, { key: 'more', segments: [{ text: hiddenLabel, dim: true }] }]
}

/**
 * 步驟列的版面：放得下就全部顯示，不收合（哪怕前面幾個已經做完）。放不下時，先把從頭
 * 數起、連續不擋路的節點（leading run，見 leadingNonBlockingCount）收成一行
 * 「✓ 前面 N 項已完成」——run 長度要有 2 個以上才值得收合。收合完（或本來就沒得收合）
 * 還是太多，改用 truncateKeepingIndex 尾端截斷，保證目前卡住的那個節點永遠留著。
 */
function stepRowsFor(states: readonly NodeState[], mission: Mission, maxInnerRows: number): BandRow[] {
  const rows = states.map(state => stepRow(state, mission))
  if (rows.length <= maxInnerRows) return rows

  const leading = leadingNonBlockingCount(states)
  const shouldCollapse = leading >= COLLAPSE_MIN_RUN
  const workingRows = shouldCollapse ? [collapsedLeadingRow(leading), ...rows.slice(leading)] : rows
  if (workingRows.length <= maxInnerRows) return workingRows

  // 收合後目前卡住的節點永遠在 index 1（index 0 是收合摘要）；沒收合就是它原本的 index
  // （leading 本身，因為 leading 就是數到第一個擋路節點為止的數量）；萬一整段都不擋路
  // （理論上不會發生：階段最後一定有必做節點），保底夾在最後一個 index，不要越界。
  const keepIndex = shouldCollapse ? 1 : Math.min(leading, workingRows.length - 1)
  return truncateKeepingIndex(workingRows, maxInnerRows, keepIndex, shouldCollapse ? leading : undefined)
}

const REVIEW_ROUNDS_WARNING_TEXT = '連續幾輪在修上一輪的修法，先停下來檢查前提'
const WARNING_ROUNDS_THRESHOLD = 3

/** 「上次同步 X 前」的相對時間；分鐘／小時／天取整數，不到 1 分鐘就講「不到 1 分鐘」。 */
function relativeTimeText(deltaMs: number): string {
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 1) return '不到 1 分鐘'
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時`
  return `${Math.floor(hours / 24)} 天`
}

/**
 * band 的版面：寬度不到 60 欄維持單行；60–99 欄只畫步驟框；100 欄以上步驟／資產框並排。
 * 高度上限取 13 跟引擎給的 maxRows 中較小的；扣掉 tabs／下一步／框線上下／標題（固定 5 行，
 * 每多一條警示列再多佔 1 行）後框內最多放 8 列，算出來連 1 列都放不下時，不管寬度多少都直接
 * 退回單行摘要。now 只有審查階段的「上次同步 X 前」要用，沒給就不顯示那段文字；有給的話會
 * 接在 tabs 列最後面當一個 dim 後綴，不占用框內列數的預算（見 withSyncSuffix），加上去會讓
 * tabs 整列超過 bodyColumns 就整個不加，不讓它折成兩行。
 */
export function bandPlan(
  mission: Mission,
  flow: MissionFlow,
  bodyColumns: number,
  maxRows: number,
  projectName: string | undefined,
  now?: number,
): BandPlan {
  const ticketsChanged = ticketsChangedSinceBuild(flow, mission)
  // specStale 跟 ticketsChanged 不一樣：不限定哪個階段，整個任務期間只要清單記的 spec
  // 比現在的 spec 檔舊，哪個階段都該提醒。
  const specStale = mission.acceptance?.specStale === true
  const currentStage = stageAt(flow, mission.stage)
  const review = currentStage.id === REVIEW_STAGE_ID ? mission.review : undefined

  const warnings: BandRow[] = []
  if (ticketsChanged) warnings.push({ key: 'tickets-changed', segments: [{ text: TICKETS_CHANGED_TEXT, color: 'warning' }] })
  if (specStale) warnings.push({ key: 'spec-stale', segments: [{ text: SPEC_STALE_TEXT, color: 'warning' }] })
  if ((review?.round ?? 0) >= WARNING_ROUNDS_THRESHOLD) {
    warnings.push({ key: 'review-rounds', segments: [{ text: REVIEW_ROUNDS_WARNING_TEXT, color: 'warning' }] })
  }

  const height = Math.min(MAX_BAND_ROWS, maxRows)
  const fixedRows = FIXED_ROWS + warnings.length
  const maxInnerRows = Math.max(0, Math.min(MAX_INNER_ROWS, height - fixedRows))

  if (bodyColumns < NARROW_COLUMNS || maxInnerRows < 1) {
    const warningTexts = warnings.map(row => row.segments[0]?.text).filter((text): text is string => text !== undefined)
    return { mode: 'narrow', line: narrowLine(mission, flow, projectName, warningTexts) }
  }

  const stage = currentStage
  const states = nodeStates(stage.nodes, mission)
  const hint = nextStepHint(flow, mission)

  const syncSuffixText = review?.lastSyncAt !== undefined && now !== undefined ? `上次同步 ${relativeTimeText(now - review.lastSyncAt)}前` : undefined
  const tabs = withSyncSuffix(tabsRow(flow, mission, projectName), syncSuffixText, bodyColumns - HELP_BUTTON_WIDTH)
  const next: BandRow = { key: 'next', segments: [{ text: `下一步：${hint}` }] }

  const steps =
    stage.nodes.length === 0
      ? [{ key: 'placeholder', segments: [{ text: '（第二期補上）', dim: true as const }] }]
      : stepRowsFor(states, mission, maxInnerRows)

  if (bodyColumns < WIDE_COLUMNS) {
    return { mode: 'steps-only', tabs, warnings, steps, next }
  }

  const existingAssets = displayedAssets(mission)
  const assetRows =
    existingAssets.length === 0
      ? [{ key: 'empty', segments: [{ text: '還沒有資產，用 /mission-link 加入', dim: true as const }] }]
      : existingAssets.map(assetRow)
  const assets = truncateRows(assetRows, maxInnerRows)

  return { mode: 'two-box', tabs, warnings, steps, assets, next }
}
