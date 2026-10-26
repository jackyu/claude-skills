// 資產清單的純函式層：網址擷取、分類、標籤命名、加入或刪除。跟 model.ts 分開放，
// 避免 model.ts 繼續長下去（已經超過 400 行的門檻）。
import type { Mission, MissionAsset, MissionAssetSource } from '../types'

export const ASSETS_CAP = 30

// 中文句子常常緊貼著網址加括號或標點（沒有空白），這些字元一律當成網址的邊界，
// 不算進網址本體：全形標點／CJK 字元的 unicode range，加上 ASCII 的收尾括號逗號跟
// 星號（markdown 的 **粗體**）。反斜線也排除在外——stdout 常常是沒解析過的 JSON
// （glab api 印出來的就是），`\/`、`&` 已經在比對前展開還原，剩下沒展開的跳脫
// （`\n`、`\r`、`\t`、`\"` 本身）靠反斜線被排除自然當成網址邊界，不用一個個特判。
// 冒號、問號、驚嘆號留著，port 號和 query string 都用得到。
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]},\\*　-〿＀-￯一-鿿]+/g
const TRAILING_PUNCT_PATTERN = /[.)\]},;:!?*]+$/
const GITLAB_PATH_PATTERN = /^\/(.+?)\/-\/(issues|work_items|merge_requests)\/(\d+)/
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i
const GRILL_WITH_DOCS_PROMPT_PATTERN = /^\/(?:[\w-]+:)?grill-with-docs(?=\s|$)/
const ISSUE_GET_SCRIPT_PATTERN = /\bissue-get\.sh\b/
const GLAB_API_ISSUES_PATTERN = /\bglab\s+api\b.*issues\//
const JSON_ESCAPED_SLASH_PATTERN = /\\\//g
const JSON_UNICODE_ESCAPE_PATTERN = /\\u([0-9a-fA-F]{4})/g

/** 舊資料（第一版寫入的）沒有 assets 欄位，讀的時候一律當空陣列。 */
export function missionAssets(mission: Mission): MissionAsset[] {
  return mission.assets ?? []
}

const ACCEPTANCE_FILE_URL_PATTERN = /^file:\/\/.*\/acceptance-[^/]+\.md$/

// 驗收清單不存進 assets：路徑已經在 mission.acceptance 裡，畫的時候現組，清單刪掉就跟著消失，
// 也不會被 /mission-unlink 刪掉後又被下一次刷新塞回來。
function acceptanceAsset(mission: Mission): MissionAsset | undefined {
  const path = mission.acceptance?.exists === true ? mission.acceptance.resolvedPath : undefined
  if (path === undefined) return undefined
  const url = `file://${encodeURI(path)}`
  const label = path.slice(path.lastIndexOf('/') + 1)
  return { url, label, description: descriptionFor(url), source: 'issue', at: mission.acceptance?.readAt ?? 0 }
}

/** band 要畫的資產：存起來的資產，加上驗收清單（排在任務自己的 issue 後面，沒有 issue 就排第一）。 */
export function displayedAssets(mission: Mission): MissionAsset[] {
  const stored = missionAssets(mission)
  const checklist = acceptanceAsset(mission)
  if (checklist === undefined) return stored
  const at = stored[0]?.source === 'issue' ? 1 : 0
  return [...stored.slice(0, at), checklist, ...stored.slice(at)]
}

/** 網址解析失敗（不是合法 URL）時原樣回傳，呼叫端自己決定要不要收。 */
function tryParseUrl(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

export function normalizeAssetUrl(url: string): string {
  return tryParseUrl(url)?.toString() ?? url
}

// GitLab 的 issue 跟 work_item 是同一張票的兩種路徑，比對鍵要收斂成同一種；
// MR 不跟 issue 混在一起。
function canonicalGitlabKind(kind: AssetKind): 'issue' | 'mr' | undefined {
  if (kind === 'gitlab-issue' || kind === 'gitlab-work-item') return 'issue'
  if (kind === 'gitlab-mr') return 'mr'
  return undefined
}

// http 跟 https 常常是同一張票的兩種進法（後端有沒有強制跳轉不一定），比對鍵一律不含 protocol。
function dropProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

/**
 * 判斷「是不是同一個資產」用的比對鍵，一律不含 protocol（http／https 視為同一個）。
 * GitLab 只認 host＋專案路徑＋種類＋iid，子路徑（/notes、/diffs、/designs/x.png）、
 * query、hash 一律忽略——issue 跟 work_item 是同一張票也會收斂成同一個鍵。
 * figma 只認 host＋路徑＋node-id：「複製連結」每次都會換一個 t= 參數，只有 node-id
 * 決定是哪個畫面，其餘 query 不管；不同 node-id 才算不同資產。
 * 存進 Mission.assets 的網址本身不經這個函式，保留原樣方便點開。
 */
export function dedupeKey(url: string): string {
  const kind = classifyUrl(url)
  const parsed = tryParseUrl(url)

  if (kind === 'figma') {
    if (parsed === undefined) return dropProtocol(normalizeAssetUrl(url))
    const nodeId = parsed.searchParams.get('node-id')
    return nodeId === null ? `${parsed.host}${parsed.pathname}` : `${parsed.host}${parsed.pathname}?node-id=${nodeId}`
  }

  if (kind === undefined) return dropProtocol(normalizeAssetUrl(url))

  const path = gitlabProjectPath(url)
  const iid = gitlabIid(url)
  const canonicalKind = canonicalGitlabKind(kind)
  if (parsed === undefined || path === undefined || iid === undefined || canonicalKind === undefined) {
    return dropProtocol(normalizeAssetUrl(url))
  }

  return `${parsed.host}/${path}/-/${canonicalKind}/${iid}`
}

export type AssetKind = 'gitlab-issue' | 'gitlab-work-item' | 'gitlab-mr' | 'figma'

function isFigmaHost(hostname: string): boolean {
  return hostname === 'figma.com' || hostname.endsWith('.figma.com')
}

export function classifyUrl(url: string): AssetKind | undefined {
  const parsed = tryParseUrl(url)
  if (parsed === undefined) return undefined
  if (isFigmaHost(parsed.hostname)) return 'figma'
  if (parsed.pathname.includes('/-/work_items/')) return 'gitlab-work-item'
  if (parsed.pathname.includes('/-/issues/')) return 'gitlab-issue'
  if (parsed.pathname.includes('/-/merge_requests/')) return 'gitlab-mr'
  return undefined
}

function gitlabPathMatch(url: string): RegExpExecArray | undefined {
  const parsed = tryParseUrl(url)
  if (parsed === undefined) return undefined
  return GITLAB_PATH_PATTERN.exec(parsed.pathname) ?? undefined
}

export function gitlabProjectPath(url: string): string | undefined {
  return gitlabPathMatch(url)?.[1]
}

export function gitlabIid(url: string): string | undefined {
  return gitlabPathMatch(url)?.[3]
}

export function projectShortName(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments.at(-1) ?? path
}

export type RemoteProjectPath = { host: string; path: string }

// 三種 remote 寫法都要支援：scp 式 git@host:path、ssh://[user@]host[:port]/path、
// https（可能帶 user:token@ 當帳密）。路徑結尾的 `\/?` 吸掉一個可能存在的尾斜線，
// 不然組網址時會變成 `host/path//-/issues/n` 多一個斜線。
const SSH_SCP_REMOTE_PATTERN = /^git@([^:]+):(.+?)(?:\.git)?\/?$/
const SSH_URL_REMOTE_PATTERN = /^ssh:\/\/(?:[^@/]*@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/
const HTTPS_REMOTE_PATTERN = /^https?:\/\/(?:[^@/]*@)?([^/]+)\/(.+?)(?:\.git)?\/?$/

/**
 * 把 git remote（scp 式、ssh://、https，含帳密與 port 的變體）拆成 host 跟專案路徑；
 * 帳密／token 一律被 `(?:[^@/]*@)?` 吃掉丟棄，絕不會出現在回傳值、組出來的網址或畫面上。
 * 認不出來就回 undefined，不硬猜。
 */
export function projectPathFromRemote(remote: string | null | undefined): RemoteProjectPath | undefined {
  if (remote === null || remote === undefined) return undefined
  const sshUrl = SSH_URL_REMOTE_PATTERN.exec(remote)
  if (sshUrl?.[1] !== undefined && sshUrl[2] !== undefined) return { host: sshUrl[1], path: sshUrl[2] }
  const scp = SSH_SCP_REMOTE_PATTERN.exec(remote)
  if (scp?.[1] !== undefined && scp[2] !== undefined) return { host: scp[1], path: scp[2] }
  const https = HTTPS_REMOTE_PATTERN.exec(remote)
  if (https?.[1] !== undefined && https[2] !== undefined) return { host: https[1], path: https[2] }
  return undefined
}

/** 任務名稱就是 issue 號時，直接用 remote 組出網址；這個來源不用猜專案，最可靠。 */
export function issueUrlFromRemote(remote: string | null | undefined, iid: string): string | undefined {
  const parsed = projectPathFromRemote(remote)
  if (parsed === undefined) return undefined
  return `https://${parsed.host}/${parsed.path}/-/issues/${iid}`
}

// 只取 $.session.repo() 用得到的這兩個欄位，不整個引入 SessionRepo 型別——這裡要維持
// 純函式（不碰 $），跟這個檔案其餘部分一致。
export type RepoRootAndRemote = { root: string; remote: string | null }

/** 標題要顯示的專案名稱：優先從 remote 拆出來，沒有 remote 就退回 repo 根目錄的最後一段；不在 repo 裡就沒有。 */
export function projectNameFor(repo: RepoRootAndRemote | null): string | undefined {
  if (repo === null) return undefined
  const fromRemote = projectPathFromRemote(repo.remote)
  if (fromRemote !== undefined) return projectShortName(fromRemote.path)
  return projectShortName(repo.root)
}

// /-/issues/new（新增頁）、/-/issues?label=x（列表篩選）都不是單一張票，沒有 iid
// 抽得出來；figma 不需要 iid，整個檔案連結本身就有意義。
function isCollectibleUrl(url: string): boolean {
  const parsed = tryParseUrl(url)
  if (parsed === undefined) return false
  const path = parsed.pathname
  if (path.includes('/uploads/')) return false
  if (IMAGE_EXT_PATTERN.test(path)) return false
  if (/avatar/i.test(path)) return false

  const kind = classifyUrl(url)
  if (kind === undefined) return false
  if (kind === 'figma') return true
  return gitlabIid(url) !== undefined
}

/**
 * stdout／prompt 文字常常是沒解析過的 JSON（glab api 印出來的就是）：比對前先把
 * `\/` 還原成 `/`、`\uXXXX` 還原成實際字元，不然網址會被這些跳脫符號打斷或吃掉
 * query 裡的 `&`。其餘跳脫（`\n`、`\"`...）不處理，留給 URL_PATTERN 排除反斜線
 * 自然擋掉。
 */
function unescapeCommonJsonSequences(text: string): string {
  return text
    .replace(JSON_ESCAPED_SLASH_PATTERN, '/')
    .replace(JSON_UNICODE_ESCAPE_PATTERN, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/** 從一段文字裡找出收得進資產清單的網址：GitLab issue／work_item／MR、Figma；排除上傳檔、圖片、頭像；同一筆只留第一次出現的那個。 */
export function extractCandidateUrls(text: string): string[] {
  const matches = unescapeCommonJsonSequences(text).match(URL_PATTERN) ?? []
  const cleaned = matches.map(url => url.replace(TRAILING_PUNCT_PATTERN, ''))
  const collectible = cleaned.filter(isCollectibleUrl)

  const seen = new Set<string>()
  const result: string[] = []
  for (const url of collectible) {
    const key = dedupeKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(url)
  }
  return result
}

/** 送出的 prompt 是不是在打 /grill-with-docs（含 plugin 前綴），只有這種才掃網址，避免平常貼的連結被收進來。 */
export function isGrillWithDocsPrompt(text: string): boolean {
  return GRILL_WITH_DOCS_PROMPT_PATTERN.test(text.trim())
}

/** Bash 指令是不是在讀 issue：glab api 打 issues/ 路徑，或者直接跑 issue-get.sh。 */
export function looksLikeIssueReadCommand(command: string): boolean {
  if (ISSUE_GET_SCRIPT_PATTERN.test(command)) return true
  return GLAB_API_ISSUES_PATTERN.test(command)
}

function baseLabelFor(url: string, ownProjectPath: string | undefined): string {
  const kind = classifyUrl(url)
  if (kind === 'figma') return '設計稿'

  const path = gitlabProjectPath(url)
  const iid = gitlabIid(url)
  if (kind === undefined || iid === undefined) return url

  const sameProject = path !== undefined && path === ownProjectPath
  const shortName = path === undefined ? '' : projectShortName(path)
  const marker = kind === 'gitlab-mr' ? '!' : '#'
  return sameProject || shortName === '' ? `${marker}${iid}` : `${shortName}${marker}${iid}`
}

// 用 `-2`、`-3` 不留空格，/mission-link／/mission-unlink 打標籤時才不用處理空白。
function uniqueLabel(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** GitLab issue／work_item：同專案 `#<n>`、跨專案 `<短名>#<n>`；MR 用 `!`；figma 統一叫「設計稿」，撞名就加序號。 */
export function labelFor(url: string, ownProjectPath: string | undefined, usedLabels: ReadonlySet<string>): string {
  return uniqueLabel(baseLabelFor(url, ownProjectPath), usedLabels)
}

/** 資產清單第二欄的簡短說明：只講種類，不帶專案名稱——跨專案的資訊已經在標籤上了（例如 rsc-pm#187）。 */
export function descriptionFor(url: string): string {
  if (ACCEPTANCE_FILE_URL_PATTERN.test(url)) return '驗收清單'
  const kind = classifyUrl(url)
  if (kind === 'figma') return 'figma'
  if (kind === undefined) return ''
  return kind === 'gitlab-mr' ? 'MR' : 'issue'
}

/** 任務名稱就是 issue 號時用這個直接建資產，不走一般的分類與撞名流程：它必然是同一個專案，標籤就是 `#<n>`。 */
export function ownIssueAsset(issueUrl: string, iid: string, now: number): MissionAsset {
  return { url: issueUrl, label: `#${iid}`, description: descriptionFor(issueUrl), source: 'issue', at: now }
}

/**
 * 把自動收集到的網址併進資產清單：已經收過的（比對鍵相同）跳過，標籤撞名自動加序號，
 * 到上限就不再加。沒有任何變化時回傳原來的 mission 參考，讓呼叫端判斷要不要寫 store。
 */
export function addCollectedAssets(
  mission: Mission,
  urls: readonly string[],
  source: MissionAssetSource,
  now: number,
  ownProjectPath: string | undefined,
): Mission {
  const existing = missionAssets(mission)
  if (urls.length === 0) return mission

  const usedKeys = new Set(existing.map(asset => dedupeKey(asset.url)))
  const usedLabels = new Set(existing.map(asset => asset.label))
  const additions: MissionAsset[] = []

  for (const url of urls) {
    if (existing.length + additions.length >= ASSETS_CAP) break
    const key = dedupeKey(url)
    if (usedKeys.has(key)) continue
    usedKeys.add(key)

    const label = labelFor(url, ownProjectPath, usedLabels)
    usedLabels.add(label)
    additions.push({ url, label, description: descriptionFor(url), source, at: now })
  }

  if (additions.length === 0) return mission
  return { ...mission, assets: [...existing, ...additions] }
}

/** `/mission-link`：同標籤已存在就覆蓋那一筆，否則新增；到上限時新標籤會被拒絕（回傳原參考）。 */
export function setManualAsset(mission: Mission, label: string, url: string, now: number): Mission {
  const existing = missionAssets(mission)
  const isOverride = existing.some(asset => asset.label === label)
  if (!isOverride && existing.length >= ASSETS_CAP) return mission

  const withoutSameLabel = existing.filter(asset => asset.label !== label)
  const asset: MissionAsset = { url, label, description: descriptionFor(url), source: 'manual', at: now }
  return { ...mission, assets: [...withoutSameLabel, asset] }
}

/** `/mission-unlink`：刪掉同標籤那一筆；找不到就回傳原參考。 */
export function removeAsset(mission: Mission, label: string): Mission {
  const existing = missionAssets(mission)
  const filtered = existing.filter(asset => asset.label !== label)
  if (filtered.length === existing.length) return mission
  return { ...mission, assets: filtered }
}
