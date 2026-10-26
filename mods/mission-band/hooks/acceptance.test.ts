import { describe, expect, test } from 'claude-code/testing'

import type { AcceptanceCounts, Mission } from '../types'
import {
  acceptanceKeyFromMissionName,
  acceptancePath,
  evaluateAcceptanceRunDoneWhen,
  evaluateOverallRegressionDoneWhen,
  evaluateRegressionWriteDoneWhen,
  isAcceptanceFileName,
  isSpecStale,
  looksLikeAcceptanceFileWrite,
  parseAcceptance,
  parseAcceptanceMeta,
  pickAcceptanceFileForMission,
} from './acceptance'

function mission(overrides: Partial<Mission> = {}): Mission {
  return { name: 'demo', flow: 'new-feature', binding: '/repo', createdAt: 0, stage: 2, skips: {}, events: [], ...overrides }
}

function counts(overrides: Partial<AcceptanceCounts> = {}): AcceptanceCounts {
  return { total: 0, passed: 0, failed: 0, blocked: 0, pending: 0, deferred: 0, regressionTodo: 0, regressionTotal: 0, ...overrides }
}

// 照抄 claude-skills/skills/_shared/acceptance/format.md 的「整份結構」範例（虛構的 #901），
// 一字不改，格式改了這份也要跟著改。
const FORMAT_MD_EXAMPLE = `# 驗收清單：#901 通知列表加上已讀狀態
<!-- acceptance:meta {"key":"901","mission":"1024-#901","branch":"feat_notice_read_state","spec":"spec-901-notice-read-state.md","specMtime":"2026-10-24T02:10:05.000Z","app":"admin","branchType":"feat"} -->

- 整體回歸：未跑

## 不在範圍

- 匯出 CSV：PM 裁決這次只做畫面顯示，匯出另開票 #905

### AC-1 未讀的通知標題是粗體
- 前提：通知列表有 2 筆，第 1 筆未讀、第 2 筆已讀
- 操作：進入通知列表
- 預期：第 1 筆標題粗體、第 2 筆一般字重
- 改動前：兩筆都是一般字重，看不出已讀未讀
- 證據：截圖（1280）、測試
- 驗不了時：必須驗過
- 回歸：是，新增 verify-admin/notice-list：已讀狀態是審核人員判斷待辦的依據
- 回歸入庫：待寫
- 來源：#901 驗收條件第 1 點、US2
- 結果：待驗

### AC-2 通知列表的分頁照常運作
- 前提：通知列表有 25 筆
- 操作：點第 2 頁
- 預期：顯示第 21–25 筆
- 改動前：同預期（既有行為不變）
- 證據：截圖（1280）
- 驗不了時：必須驗過
- 回歸：否
- 來源：US5
- 結果：待驗

### AC-3（已刪除）點通知後自動標成已讀
- 來源：US3
- 結果：已刪除｜2026-10-24 規格改成手動標記，移到 #902

### AC-4 後端回傳的未讀數跟列表一致
- 前提：後端 #907 已部署到 UAT
- 操作：打 \`GET /notices?page=1\`，對照回應的 \`unreadCount\` 和 \`items\`
- 預期：\`unreadCount\` 等於 \`items\` 裡未讀的筆數
- 改動前：無（新功能）
- 證據：指令輸出
- 驗不了時：可後補｜等後端 #907 部署到 UAT
- 回歸：否
- 來源：US4
- 結果：待驗
`

describe('parseAcceptance: format.md 的 #901 範例', () => {
  const summary = parseAcceptance(FORMAT_MD_EXAMPLE)

  test('meta 逐欄解析正確', () => {
    expect(summary.meta).toEqual({
      key: '901',
      mission: '1024-#901',
      branch: 'feat_notice_read_state',
      spec: 'spec-901-notice-read-state.md',
      specMtime: '2026-10-24T02:10:05.000Z',
      app: 'admin',
      branchType: 'feat',
    })
  })

  test('整體回歸是未跑，沒有 sha', () => {
    expect(summary.overall).toEqual({ status: '未跑' })
  })

  test('四條 AC 都解析出來，已刪除的那條標記 deleted', () => {
    expect(summary.items).toHaveLength(4)
    expect(summary.items[0]).toMatchObject({ id: 'AC-1', deleted: false, title: '未讀的通知標題是粗體', status: '待驗' })
    expect(summary.items[1]).toMatchObject({ id: 'AC-2', deleted: false, title: '通知列表的分頁照常運作', status: '待驗' })
    expect(summary.items[2]).toMatchObject({ id: 'AC-3', deleted: true, title: '點通知後自動標成已讀', status: '已刪除' })
    expect(summary.items[3]).toMatchObject({ id: 'AC-4', deleted: false, title: '後端回傳的未讀數跟列表一致', status: '待驗' })
  })

  test('needsBefore：AC-1 要補 Before（改動前是真的變了），AC-2 不用（同預期），已刪除的 AC-3 也不用（沒有改動前欄），AC-4 不用（無（新功能））', () => {
    expect(summary.items[0]?.needsBefore).toBe(true)
    expect(summary.items[1]?.needsBefore).toBe(false)
    expect(summary.items[2]?.needsBefore).toBe(false)
    expect(summary.items[3]?.needsBefore).toBe(false)
  })

  test('AC-4 的驗不了時是可後補', () => {
    expect(summary.items[3]?.deferrability).toBe('可後補')
  })

  test('counts：已刪除的 AC-3 不計入 total；AC-1／AC-2／AC-4 都待驗；只有 AC-1 回歸是，且回歸入庫待寫', () => {
    expect(summary.counts).toEqual({
      total: 3,
      passed: 0,
      failed: 0,
      blocked: 0,
      deferred: 0,
      pending: 3,
      regressionTotal: 1,
      regressionTodo: 1,
    })
  })
})

describe('parseAcceptance: AC 標題解析', () => {
  test('兩位數字的 id（AC-10）不會被截成 AC-1', () => {
    const text = '### AC-10 兩位數 id\n- 結果：待驗\n'
    const summary = parseAcceptance(text)
    expect(summary.items).toHaveLength(1)
    expect(summary.items[0]?.id).toBe('AC-10')
  })

  test('已刪除的條目沒有標題也能解析（標題欄留空）', () => {
    const text = '### AC-3（已刪除）\n- 來源：US3\n- 結果：已刪除｜理由\n'
    const summary = parseAcceptance(text)
    expect(summary.items[0]).toMatchObject({ id: 'AC-3', deleted: true, title: '' })
  })

  test('認不得的行一律忽略，不會丟錯', () => {
    const text = '### AC-1 標題\n不是欄位格式的一行\n- 範圍：admin\n- 結果：待驗\n'
    expect(() => parseAcceptance(text)).not.toThrow()
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.fields['範圍']).toBe('admin')
  })
})

describe('parseAcceptance: 全形／半形分隔符都要接受', () => {
  test('欄位冒號用半形 :', () => {
    const text = '### AC-1 x\n- 結果:待驗\n'
    expect(parseAcceptance(text).items[0]?.status).toBe('待驗')
  })

  test('結果用半形 | 接內容', () => {
    const text = '### AC-1 x\n- 結果：通過|測試 foo（紅→綠）\n'
    expect(parseAcceptance(text).items[0]?.status).toBe('通過')
  })

  test('整體回歸半形冒號也接受', () => {
    const text = '- 整體回歸:未跑\n### AC-1 x\n- 結果：待驗\n'
    expect(parseAcceptance(text).overall).toEqual({ status: '未跑' })
  })

  // CRLF：整份文字用 \r\n 換行（例如 Windows 編輯器存檔）也要解析得出來，不能因為
  // 「結果：待驗\r」多了一個 \r 就比對不到白名單。
  test('CRLF 換行也能正常解析', () => {
    const text = '### AC-1 x\r\n- 結果：待驗\r\n- 來源：US1\r\n'
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.status).toBe('待驗')
    expect(summary.items[0]?.fields['來源']).toBe('US1')
  })

  test('整體回歸搭配 CRLF 也能解析', () => {
    const text = '- 整體回歸：未跑\r\n### AC-1 x\r\n- 結果：待驗\r\n'
    expect(parseAcceptance(text).overall).toEqual({ status: '未跑' })
  })

  // 狀態詞跟分隔符之間多打了一個空格（「通過 ｜測試」）也要認得出來，不能因為中間
  // 多一個空白就退回待驗。
  test('狀態詞跟分隔符之間多一個空格也算那個狀態', () => {
    const text = '### AC-1 x\n- 結果：通過 ｜測試 foo（紅→綠）\n'
    expect(parseAcceptance(text).items[0]?.status).toBe('通過')
  })
})

describe('parseAcceptance: 結果狀態', () => {
  test('缺少結果行當成待驗', () => {
    const text = '### AC-1 x\n- 來源：a\n'
    expect(parseAcceptance(text).items[0]?.status).toBe('待驗')
  })

  test('認不得的狀態詞當成待驗', () => {
    const text = '### AC-1 x\n- 結果：還沒開始測\n'
    expect(parseAcceptance(text).items[0]?.status).toBe('待驗')
  })

  // 白名單比對規則：那個詞要整個等於值，或緊接著分隔符；「通過（部分）」不符合兩者，一律當待驗。
  test('狀態詞只是字首相同、後面接別的字（不是分隔符）不算那個狀態——通過（部分）不算通過', () => {
    const text = '### AC-1 x\n- 結果：通過（部分）\n'
    expect(parseAcceptance(text).items[0]?.status).toBe('待驗')
  })

  test('受阻不算未過，也不算完成：total 算進去，但 failed／passed 都不含它', () => {
    const text = ['### AC-1 x', '- 回歸：否', '- 結果：受阻｜沒有 .env 起不了 app'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.status).toBe('受阻')
    expect(summary.counts).toMatchObject({ total: 1, passed: 0, failed: 0, blocked: 1, pending: 0 })
  })

  // 標題有沒有「（已刪除）」跟結果欄是不是已刪除，規格上該一致，但清單是手改的，
  // 難免漏改標題；total 要看結果欄，不要求標題也同步改過。
  test('標題沒標（已刪除），但結果欄寫已刪除：還是不計入 total', () => {
    const text = ['### AC-1 忘記在標題加已刪除標記', '- 來源：US1', '- 結果：已刪除｜2026-10-24 規格改了'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.items[0]).toMatchObject({ id: 'AC-1', deleted: false, status: '已刪除' })
    expect(summary.counts.total).toBe(0)
  })

  test('待重驗計入 pending', () => {
    const text = '### AC-1 x\n- 結果：待重驗｜改動前\n'
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.status).toBe('待重驗')
    expect(summary.counts.pending).toBe(1)
  })
})

describe('parseAcceptance: 驗不了時（後補 vs 受阻）', () => {
  test('可後補的受阻算 deferred，不算 blocked', () => {
    const text = ['### AC-1 x', '- 驗不了時：可後補｜等後端 #907 部署到 UAT', '- 結果：受阻｜缺後端'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ total: 1, blocked: 0, deferred: 1 })
  })

  test('必須驗過的受阻還是算 blocked，不算 deferred', () => {
    const text = ['### AC-1 x', '- 驗不了時：必須驗過', '- 結果：受阻｜缺 .env'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ total: 1, blocked: 1, deferred: 0 })
  })

  test('缺驗不了時這一欄的受阻，當成必須驗過，照樣算 blocked', () => {
    const text = ['### AC-1 x', '- 結果：受阻｜缺 .env'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ total: 1, blocked: 1, deferred: 0 })
  })

  test('全形冒號「可後補：」也接受', () => {
    const text = ['### AC-1 x', '- 驗不了時：可後補：等後端部署', '- 結果：受阻｜缺後端'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ blocked: 0, deferred: 1 })
  })

  test('認不得的值當成必須驗過，受阻照樣算 blocked', () => {
    const text = ['### AC-1 x', '- 驗不了時：隨便寫的值', '- 結果：受阻｜缺後端'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ blocked: 1, deferred: 0 })
  })

  test('通過｜只驗前端｜… 一樣算通過，不受驗不了時欄影響', () => {
    const text = ['### AC-1 x', '- 驗不了時：只驗前端', '- 結果：通過｜只驗前端｜截圖 a.png'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.status).toBe('通過')
    expect(summary.counts).toMatchObject({ total: 1, passed: 1, blocked: 0, deferred: 0 })
  })

  test('只驗前端的受阻不算 deferred，照樣算 blocked', () => {
    const text = ['### AC-1 x', '- 驗不了時：只驗前端', '- 結果：受阻｜後端那半還沒驗'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ blocked: 1, deferred: 0 })
  })

  // format.md 解析規則：只有「可後補」後面多接受全形｜｜當分隔符，半形冒號對任何值都不算
  // （產生時一律寫 ｜，半形冒號解析也不放寬）。
  test('半形冒號「可後補:」不算，退回必須驗過，受阻照樣 blocked', () => {
    const text = ['### AC-1 x', '- 驗不了時：可後補:等後端部署', '- 結果：受阻｜缺後端'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.deferrability).toBe('必須驗過')
    expect(summary.counts).toMatchObject({ blocked: 1, deferred: 0 })
  })

  // 全形冒號的例外只給「可後補」，「只驗前端」接全形冒號不算，退回必須驗過。
  test('「只驗前端：」接全形冒號不算，退回必須驗過，受阻照樣 blocked', () => {
    const text = ['### AC-1 x', '- 驗不了時：只驗前端：補充說明', '- 結果：受阻｜後端那半還沒驗'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.items[0]?.deferrability).toBe('必須驗過')
    expect(summary.counts).toMatchObject({ blocked: 1, deferred: 0 })
  })

  test('未過＋可後補：算 failed，不算 deferred（deferred 只看受阻）', () => {
    const text = ['### AC-1 x', '- 驗不了時：可後補｜等後端部署', '- 結果：未過｜截圖不符預期'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ total: 1, failed: 1, blocked: 0, deferred: 0 })
  })

  test('已刪除＋可後補：不計入 total，也不算 deferred', () => {
    const text = ['### AC-1 x', '- 驗不了時：可後補｜等後端部署', '- 結果：已刪除｜2026-10-26 規格改了'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ total: 0, failed: 0, blocked: 0, deferred: 0 })
  })
})

describe('parseAcceptance: ## 不在範圍 段落（第一個 AC 之前）', () => {
  test('有這段也能正常解析，counts 不受影響', () => {
    const text = [
      '# 驗收清單：#901 範例',
      '<!-- acceptance:meta {"key":"901"} -->',
      '',
      '- 整體回歸：未跑',
      '',
      '## 不在範圍',
      '',
      '- 匯出 CSV：PM 裁決這次只做畫面顯示，匯出另開票 #905',
      '',
      '### AC-1 x',
      '- 結果：通過｜測試 foo（紅→綠）',
    ].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.items).toHaveLength(1)
    expect(summary.counts).toMatchObject({ total: 1, passed: 1 })
    expect(summary.overall).toEqual({ status: '未跑' })
  })
})

describe('parseAcceptance: 整體回歸', () => {
  test('通過｜iso｜sha｜n 解析出 sha', () => {
    const text = '- 整體回歸：通過｜2026-10-24T03:00:00.000Z｜dea29bb64f0c1a2b3c4d5e6f7890abcdef12345｜3 條 journey\n### AC-1 x\n- 結果：待驗\n'
    expect(parseAcceptance(text).overall).toEqual({ status: '通過', sha: 'dea29bb64f0c1a2b3c4d5e6f7890abcdef12345' })
  })

  test('認不得的整體回歸詞當成未跑', () => {
    const text = '- 整體回歸：還沒跑過\n### AC-1 x\n- 結果：待驗\n'
    expect(parseAcceptance(text).overall).toEqual({ status: '未跑' })
  })

  test('沒有整體回歸這一行也當成未跑', () => {
    expect(parseAcceptance('### AC-1 x\n- 結果：待驗\n').overall).toEqual({ status: '未跑' })
  })
})

describe('parseAcceptance: 回歸入庫白名單', () => {
  test('已寫不算進 regressionTodo', () => {
    const text = ['### AC-1 x', '- 回歸：是，更新 a/b：理由', '- 回歸入庫：已寫｜path/a.ts', '- 結果：通過｜測試 x（紅→綠）'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ regressionTotal: 1, regressionTodo: 0 })
  })

  test('認不得的回歸入庫詞當成待寫（還要補）', () => {
    const text = ['### AC-1 x', '- 回歸：是，更新 a/b：理由', '- 回歸入庫：進行中', '- 結果：待驗'].join('\n')
    const summary = parseAcceptance(text)
    expect(summary.counts).toMatchObject({ regressionTotal: 1, regressionTodo: 1 })
  })

  test('缺回歸入庫這一行（回歸是，但沒寫這欄）也當成待寫', () => {
    const text = ['### AC-1 x', '- 回歸：是，更新 a/b：理由', '- 結果：待驗'].join('\n')
    expect(parseAcceptance(text).counts).toMatchObject({ regressionTotal: 1, regressionTodo: 1 })
  })
})

describe('parseAcceptanceMeta: 容忍壞資料', () => {
  test('JSON 壞掉回空物件，不丟錯', () => {
    const text = '<!-- acceptance:meta {"key":"1",} -->\n'
    expect(() => parseAcceptanceMeta(text)).not.toThrow()
    expect(parseAcceptanceMeta(text)).toEqual({})
  })

  test('完全沒有 meta 這行也回空物件', () => {
    expect(parseAcceptanceMeta('### AC-1 x\n- 結果：待驗\n')).toEqual({})
  })

  test('meta 是合法 JSON 但不是物件（例如陣列）也回空物件', () => {
    expect(parseAcceptanceMeta('<!-- acceptance:meta [1,2,3] -->\n')).toEqual({})
  })

  test('缺 mission／branch 兩個新欄位也能解析（舊資料相容）', () => {
    const text = '<!-- acceptance:meta {"key":"473","spec":null,"app":"client","branchType":"bug"} -->\n'
    expect(parseAcceptanceMeta(text)).toEqual({ key: '473', spec: null, app: 'client', branchType: 'bug' })
  })
})

describe('acceptanceKeyFromMissionName', () => {
  test('MMDD-#<iid> 直接拼出 key', () => {
    expect(acceptanceKeyFromMissionName('1024-#473')).toBe('473')
  })

  // 實際任務名常是「日期＋自訂標籤＋#issue」這種形狀，不是只有 MMDD-#473；
  // format.md 的規則是「任務名裡隨便哪裡出現 #<數字> 都算」，不要求在字串結尾。
  test('MMDD-<標籤>-#<iid>（例如 1022-issue-#473）也能拼出 key，#<數字> 不用在字串結尾', () => {
    expect(acceptanceKeyFromMissionName('1022-issue-#473')).toBe('473')
  })

  // 2026-10-24 格式契約更新：非 issue 的任務名不再有「去掉日期當 key」的推導，
  // 一律改成掃 .claude/specs/acceptance-*.md 配 meta.mission（見 pickAcceptanceFileForMission）。
  test('MMDD-<名稱> 沒有 #<數字>，回 undefined（要掃目錄配 meta.mission）', () => {
    expect(acceptanceKeyFromMissionName('1024-tour-notes')).toBeUndefined()
  })
})

describe('acceptancePath', () => {
  test('拼出 <repoRoot>/.claude/specs/acceptance-<key>.md', () => {
    expect(acceptancePath('/repo', '473')).toBe('/repo/.claude/specs/acceptance-473.md')
  })
})

describe('isAcceptanceFileName', () => {
  test('acceptance-<任意>.md 算，其他檔名不算', () => {
    expect(isAcceptanceFileName('acceptance-473.md')).toBe(true)
    expect(isAcceptanceFileName('acceptance-tour-notes.md')).toBe(true)
    expect(isAcceptanceFileName('spec-473-foo.md')).toBe(false)
    expect(isAcceptanceFileName('acceptance-473.md.bak')).toBe(false)
  })
})

describe('looksLikeAcceptanceFileWrite', () => {
  test('.claude/specs/acceptance-<key>.md 結尾算，不管 key', () => {
    expect(looksLikeAcceptanceFileWrite('/repo/.claude/specs/acceptance-473.md')).toBe(true)
    expect(looksLikeAcceptanceFileWrite('/repo/.claude/worktrees/x/.claude/specs/acceptance-tour-notes.md')).toBe(true)
  })

  test('不相關的檔案（spec 檔、別的目錄）不算', () => {
    expect(looksLikeAcceptanceFileWrite('/repo/.claude/specs/spec-473-foo.md')).toBe(false)
    expect(looksLikeAcceptanceFileWrite('/repo/docs/acceptance-473.md')).toBe(false)
  })
})

describe('pickAcceptanceFileForMission', () => {
  const entries = [
    { name: 'acceptance-tour-notes.md', text: '<!-- acceptance:meta {"key":"tour-notes","mission":"1024-tour-notes"} -->\n' },
    { name: 'acceptance-901.md', text: '<!-- acceptance:meta {"key":"901","mission":"1024-#901"} -->\n' },
    { name: 'spec-473-foo.md', text: '不是驗收清單，就算裡面剛好有 mission 字串也不算' },
  ]

  test('找到 meta.mission 等於任務名的那一份', () => {
    expect(pickAcceptanceFileForMission(entries, '1024-tour-notes')).toBe('acceptance-tour-notes.md')
  })

  test('找不到配對的任務名回 undefined', () => {
    expect(pickAcceptanceFileForMission(entries, '1025-nope')).toBeUndefined()
  })

  test('不符合 acceptance-*.md 檔名的候選一律跳過，不解析它的內容', () => {
    expect(pickAcceptanceFileForMission(entries, 'spec-473-foo')).toBeUndefined()
  })
})

describe('isSpecStale', () => {
  const META_SPEC_MTIME = '2026-10-24T02:10:05.000Z'
  const sameSecondMs = Date.parse(META_SPEC_MTIME)

  test('同一秒內（含毫秒差）不算改過', () => {
    expect(isSpecStale(sameSecondMs, META_SPEC_MTIME)).toBe(false)
    expect(isSpecStale(sameSecondMs + 999, META_SPEC_MTIME)).toBe(false)
  })

  test('跨到下一秒才算改過', () => {
    expect(isSpecStale(sameSecondMs + 1000, META_SPEC_MTIME)).toBe(true)
  })

  test('spec mtime 比 meta 記的更舊，不算改過', () => {
    expect(isSpecStale(sameSecondMs - 5000, META_SPEC_MTIME)).toBe(false)
  })

  test('meta 沒有 specMtime 就不判斷（回 false）', () => {
    expect(isSpecStale(sameSecondMs, undefined)).toBe(false)
  })

  test('meta 的 specMtime 格式壞掉也不判斷（回 false，不丟錯）', () => {
    expect(() => isSpecStale(sameSecondMs, '不是時間')).not.toThrow()
    expect(isSpecStale(sameSecondMs, '不是時間')).toBe(false)
  })
})

describe('evaluateAcceptanceRunDoneWhen（逐條驗收）', () => {
  test('沒有驗收清單：not done，沒有 detail', () => {
    const result = evaluateAcceptanceRunDoneWhen(mission())
    expect(result).toEqual({ done: false })
  })

  test('清單存在但 0 條（非已刪除）：not done，沒有 detail', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ total: 0 }), readAt: 0 } })
    expect(evaluateAcceptanceRunDoneWhen(m)).toEqual({ done: false })
  })

  test('有未過／受阻：not done，detail 列出各自的數量', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ total: 8, passed: 5, failed: 1, blocked: 2 }), readAt: 0 } })
    expect(evaluateAcceptanceRunDoneWhen(m)).toEqual({ done: false, detail: 'AC 5/8，1 未過，2 受阻' })
  })

  test('只有未過、沒有受阻：detail 省略「0 受阻」', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ total: 4, passed: 3, failed: 1, blocked: 0 }), readAt: 0 } })
    expect(evaluateAcceptanceRunDoneWhen(m)).toEqual({ done: false, detail: 'AC 3/4，1 未過' })
  })

  test('全部通過：done，detail 一樣顯示 AC 數（沒有未過／受阻可省略）', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ total: 3, passed: 3 }), readAt: 0 } })
    expect(evaluateAcceptanceRunDoneWhen(m)).toEqual({ done: true, detail: 'AC 3/3' })
  })

  test('剩下的全是後補：done，detail 附上「N 後補」', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ total: 3, passed: 2, deferred: 1 }), readAt: 0 } })
    expect(evaluateAcceptanceRunDoneWhen(m)).toEqual({ done: true, detail: 'AC 2/3，1 後補' })
  })

  test('有一條必須驗過的受阻還沒解：not done，即使同時有後補的條目', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ total: 3, passed: 1, blocked: 1, deferred: 1 }), readAt: 0 } })
    const result = evaluateAcceptanceRunDoneWhen(m)
    expect(result.done).toBe(false)
    expect(result.detail).toBe('AC 1/3，1 受阻，1 後補')
  })

  test('舊資料沒有 deferred 欄位（undefined）當成 0，不影響 done 判斷', () => {
    const m = mission({ acceptance: { exists: true, counts: { total: 2, passed: 2, failed: 0, blocked: 0, pending: 0, regressionTodo: 0, regressionTotal: 0 }, readAt: 0 } })
    expect(evaluateAcceptanceRunDoneWhen(m)).toEqual({ done: true, detail: 'AC 2/2' })
  })
})

describe('evaluateRegressionWriteDoneWhen（回歸入庫）', () => {
  // 舊任務沒有驗收清單：直接算完成、透明放過，不強迫補跑 /to-acceptance 才能過這一關；
  // 真的要擋的話擋在 acceptance-run 跟 overall-regression。
  test('沒有驗收清單（舊任務）：done，透明放過', () => {
    expect(evaluateRegressionWriteDoneWhen(mission())).toEqual({ done: true })
  })

  test('沒有任何一條需要補回歸測試（regressionTotal 是 0）：直接算完成，不用使用者跳過', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ regressionTotal: 0 }), readAt: 0 } })
    expect(evaluateRegressionWriteDoneWhen(m)).toEqual({ done: true })
  })

  test('還有待寫的：not done，detail 是待寫的條數', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ regressionTotal: 3, regressionTodo: 2 }), readAt: 0 } })
    expect(evaluateRegressionWriteDoneWhen(m)).toEqual({ done: false, detail: '2 條待寫' })
  })

  test('全部寫完了（regressionTodo 是 0，但 regressionTotal 大於 0）：done，detail 顯示已寫的條數', () => {
    const m = mission({ acceptance: { exists: true, counts: counts({ regressionTotal: 3, regressionTodo: 0 }), readAt: 0 } })
    expect(evaluateRegressionWriteDoneWhen(m)).toEqual({ done: true, detail: '3 條已寫' })
  })
})

describe('evaluateOverallRegressionDoneWhen（整體回歸）', () => {
  test('沒有驗收清單：not done', () => {
    expect(evaluateOverallRegressionDoneWhen(mission())).toEqual({ done: false })
  })

  test('整體回歸是未跑／未過／受阻：not done', () => {
    for (const status of ['未跑', '未過', '受阻'] as const) {
      const m = mission({ acceptance: { exists: true, overall: { status }, readAt: 0 } })
      expect(evaluateOverallRegressionDoneWhen(m).done).toBe(false)
    }
  })

  test('整體回歸通過、且沒有過期：done', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '通過', sha: 'abc' }, overallStale: false, readAt: 0 } })
    expect(evaluateOverallRegressionDoneWhen(m)).toEqual({ done: true })
  })

  test('整體回歸通過，但記錄的 sha 跟現在的 HEAD 不一樣（overallStale）：當成未跑，附理由', () => {
    const m = mission({ acceptance: { exists: true, overall: { status: '通過', sha: 'abc' }, overallStale: true, readAt: 0 } })
    expect(evaluateOverallRegressionDoneWhen(m)).toEqual({ done: false, detail: 'commit 變了' })
  })
})
