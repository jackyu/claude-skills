import { describe, expect, test } from 'claude-code/testing'

import type { Mission } from '../types'
import { evaluateMrDoneWhen, missingAcIdsInEvidence, mrDoneWhenDetail } from './mr-evidence'

function mission(overrides: Partial<Mission> = {}): Mission {
  return { name: 'demo', flow: 'new-feature', binding: '/repo', createdAt: 0, stage: 3, skips: {}, events: [], ...overrides }
}

describe('missingAcIdsInEvidence', () => {
  const description = ['## 關聯', '#473', '', '## Evidence', 'AC-1：截圖 xxx', 'AC-2：測試 yyy', '', '## Merge Danger', '沒有'].join('\n')

  test('Evidence 段落有提到的 AC 不算缺', () => {
    expect(missingAcIdsInEvidence(description, ['AC-1', 'AC-2'])).toEqual([])
  })

  test('Evidence 段落沒提到的 AC 算缺', () => {
    expect(missingAcIdsInEvidence(description, ['AC-1', 'AC-2', 'AC-3'])).toEqual(['AC-3'])
  })

  test('只找 Evidence 段落本身的範圍，其他段落剛好出現 AC id 不算', () => {
    const text = ['## 關聯', 'AC-3 相關', '', '## Evidence', 'AC-1', '', '## Merge Danger', 'AC-2'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2', 'AC-3'])).toEqual(['AC-2', 'AC-3'])
  })

  test('標題帶 emoji 也找得到 Evidence 段落', () => {
    const text = ['## 🔗 關聯', 'x', '', '## 📋 Evidence', 'AC-1', ''].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual(['AC-2'])
  })

  test('不管第幾級標題都找得到（### Evidence 也算）', () => {
    const text = ['# 標題', '', '### Evidence', 'AC-1', ''].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1'])).toEqual([])
  })

  test('Evidence 段落一路到檔案結尾（後面沒有下一個標題）也抓得到', () => {
    const text = ['## 關聯', 'x', '', '## Evidence', 'AC-1', 'AC-2'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual([])
  })

  test('完全沒有 Evidence 段落：回空陣列（missingSections 已經會報缺 Evidence，不重複報每條 AC）', () => {
    const text = ['## 關聯', 'x', '', '## Merge Danger', '沒有'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual([])
  })

  test('沒有任何 AC（acIds 空陣列，例如沒有驗收清單）：回空陣列', () => {
    expect(missingAcIdsInEvidence(description, [])).toEqual([])
  })

  // 邊界問題：AC-1 是 AC-10 的字首，單純 includes 會被 AC-10 誤判成「AC-1 也提到了」。
  test('AC-1 不會被 AC-10 誤判成「有提到」——id 後面要是數字邊界，不能緊接著數字', () => {
    const text = ['## Evidence', 'AC-10 截圖通過', ''].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-10'])).toEqual(['AC-1'])
  })

  // Evidence 底下常常會按 AC 分小標題（### AC-1、### AC-2），這些子標題層級比 Evidence
  // 標題深，算 Evidence 段落的內文，不該讓段落在第一個子標題就提早結束變成空的。
  test('Evidence 底下的子標題（層級更深）算內文，不會讓段落提早結束變成空的', () => {
    const text = ['## Evidence', '### AC-1', '截圖通過', '### AC-2', '測試通過（紅→綠）', '', '## Merge Danger', '沒有'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual([])
  })

  test('只有層級 ≤ Evidence 標題層級的標題才會結束段落', () => {
    // Evidence 是 level 2（##），下面的 level 3（###）子標題不算數，直到下一個 level 2
    // 的「## Merge Danger」才真的結束；AC-2 寫在 Merge Danger 底下，不算進 Evidence 段落。
    const text = ['## Evidence', '### AC-1', 'AC-1 截圖', '## Merge Danger', 'AC-2 這裡提到也不算'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual(['AC-2'])
  })

  // 標題「包含」Evidence 字樣不算，要去掉 emoji／空白後「以 Evidence 開頭」才算——避免
  // 「## 關聯 Evidence 討論」這種標題被誤認成 Evidence 段落本身。故意讓 AC-1 完全沒出現在
  // 附近：如果誤判成 Evidence 段落，AC-1 會被判成缺；照規則「沒有 Evidence 段落」整段都
  // 不報，兩種結果不一樣才測得出差異。
  test('標題只是包含 Evidence 字樣、不是以它開頭：不算 Evidence 段落（不會把 AC-1 判成缺）', () => {
    const text = ['## 關聯 Evidence 討論', '這裡沒有提到任何 AC id', ''].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1'])).toEqual([])
  })

  test('Evidence 後面接著別的字（不是單字邊界，例如 Evidences）：不算', () => {
    const text = ['## Evidences 的部分', '這裡沒有提到任何 AC id', ''].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1'])).toEqual([])
  })

  // 程式碼區塊（``` 圍起來）裡剛好有一行開頭是 #，不該被當成標題，不會提早結束 Evidence 段落。
  test('``` 圍起來的程式碼區塊裡的 # 開頭行不算標題', () => {
    const text = ['## Evidence', '```', '# 這是程式碼註解，不是標題', 'AC-1', '```', 'AC-2'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual([])
  })

  // Markdown 的 ATX 標題規則要求 # 後面接空白才算標題；「#473 測試紀錄」這種提到 issue
  // 編號的句子，# 後面緊接著數字，不是標題，不該被誤判成 level-1 標題提早結束 Evidence 段落。
  test('「#473 測試紀錄」這種 # 後面緊接數字（不是空白）的句子不算標題，不會提早結束 Evidence 段落', () => {
    const text = ['## Evidence', '#473 測試紀錄', 'AC-1 截圖通過', 'AC-2 測試通過（紅→綠）'].join('\n')
    expect(missingAcIdsInEvidence(text, ['AC-1', 'AC-2'])).toEqual([])
  })
})

describe('mrDoneWhenDetail', () => {
  test('兩種都沒缺：沒有 detail', () => {
    expect(mrDoneWhenDetail([], [])).toBeUndefined()
  })

  test('只缺段落：維持原來完整列出段落名稱的寫法', () => {
    expect(mrDoneWhenDetail(['Merge Danger', 'Evidence'], [])).toBe('缺 Merge Danger、Evidence')
  })

  test('只缺 Evidence 裡的 AC：列出 AC id', () => {
    expect(mrDoneWhenDetail([], ['AC-3'])).toBe('Evidence 缺 AC-3')
    expect(mrDoneWhenDetail([], ['AC-3', 'AC-5'])).toBe('Evidence 缺 AC-3、AC-5')
  })

  test('兩種都缺：各自換成數量（放不進 38 字兩份都列全）', () => {
    expect(mrDoneWhenDetail(['Merge Danger', 'Evidence'], ['AC-1', 'AC-2', 'AC-3'])).toBe('缺 2 段、Evidence 缺 3 條')
  })
})

describe('evaluateMrDoneWhen', () => {
  test('沒有 mr 事件：not done，沒有 detail', () => {
    expect(evaluateMrDoneWhen(mission(), 0)).toEqual({ done: false })
  })

  test('有 mr 事件、什麼都沒缺：done，沒有 detail', () => {
    const m = mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: [], missingAcs: [] }] })
    expect(evaluateMrDoneWhen(m, 0)).toEqual({ done: true, detail: undefined })
  })

  test('有 mr 事件、段落跟 AC 都缺：done，detail 是組合後的數量版文字', () => {
    const m = mission({
      events: [{ at: 1, kind: 'product', name: 'mr', missingSections: ['Merge Danger', 'Evidence'], missingAcs: ['AC-1', 'AC-2', 'AC-3'] }],
    })
    expect(evaluateMrDoneWhen(m, 0)).toEqual({ done: true, detail: '缺 2 段、Evidence 缺 3 條' })
  })

  test('舊資料的 mr 事件沒有 missingAcs 這個欄位：當空陣列，不出錯', () => {
    const m = mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: ['Evidence'] }] })
    expect(evaluateMrDoneWhen(m, 0)).toEqual({ done: true, detail: '缺 Evidence' })
  })

  test('enteredAt 之前的 mr 事件不算（跟 products.ts 原本的 mr 判斷時間窗一致）', () => {
    const m = mission({ events: [{ at: 1, kind: 'product', name: 'mr', missingSections: [] }] })
    expect(evaluateMrDoneWhen(m, 5).done).toBe(false)
  })
})
