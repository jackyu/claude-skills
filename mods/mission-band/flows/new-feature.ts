import { latestMrIid, reverifySkipReason } from '../hooks/review-stage'
import type { MissionFlow } from '../types'

// MR 描述要有的段落關鍵字；跟 fe-mr-generator 的段落順序對齊（第 2 項定案後再調整）。
// 比對時只看關鍵字本身，不管 emoji、也不管是第幾級標題（見 hooks/products.ts 的 missingMrSections）。
export const MR_SECTION_KEYWORDS = ['關聯', '為什麼要這樣做', 'Summary', 'Merge Danger', 'Evidence'] as const

export const NEW_FEATURE_FLOW: MissionFlow = {
  name: 'new-feature',
  stages: [
    {
      id: 'start',
      label: '開始',
      nodes: [
        {
          id: 'grill-with-docs',
          matchSkill: 'grill-with-docs',
          hint: '請輸入 /grill-with-docs，把需求問到能拿來驗收',
        },
        {
          id: 'approach',
          matchSkill: 'approach',
          hint: '輸入 /approach，檢查要用套件還是手寫、放哪裡、介面形狀、從哪裡開始；舊任務不需要就 /mission-skip approach <理由>',
        },
        {
          id: 'prototype',
          optional: true,
          matchSkill: 'prototype',
          matchRead: 'playbook:prototype',
          hint: '有要做的設計決定才做 prototype；不做就 /mission-skip prototype <理由>',
        },
        {
          id: 'to-spec',
          matchSkill: 'to-spec',
          hint: '在同一段對話輸入 /to-spec，把討論整理成 spec',
        },
        {
          id: 'to-acceptance',
          matchSkill: 'to-acceptance',
          doneWhen: 'acceptance-file',
          hint: '輸入 /to-acceptance 產生驗收清單；舊任務不需要就 /mission-skip to-acceptance <理由>',
        },
        {
          id: 'to-tickets',
          optional: true,
          matchSkill: 'to-tickets',
          hint: '小票可以跳過；要拆成多張票就輸入 /to-tickets',
        },
        {
          id: 'create-worktree',
          doneWhen: 'worktree',
          hint: '直接跟 AI 說「orca worktree create」請它建（不要加 !，band 是從 AI 跑的指令記下路徑）；打勾後 /mission-next，再 /mission-go 開新分頁',
        },
      ],
    },
    {
      id: 'build',
      label: '實作',
      nodes: [
        {
          id: 'implement',
          matchSkill: ['implement', 'implement-spec', 'tdd'],
          doneWhen: 'commit',
          hint: '輸入 /implement 或走 TDD 開始實作',
        },
        {
          id: 'no-comments',
          matchSkill: 'no-comments',
          matchRead: 'pstack:no-comments',
          hint: '實作完輸入 /pstack:no-comments；它會清註解、也可能直接改 code 修問題，並停下來等你核准編碼限制；舊任務不需要就 /mission-skip no-comments <理由>',
        },
        {
          // Codex 不是獨立的一步，是 code review 的第二意見，所以跟 Claude 的審查併成同一個
          // 節點的兩條軌道，而不是後面接著的另一個節點；兩條都跑過、或 Codex 被跳過，才算完成。
          id: 'code-review',
          hint: '實作完輸入 /mattpocock-skills:code-review 審 Spec、Standards 兩軸（改動大或風險高再改用 /cr），順便跑 node ~/.claude/scripts/jev-xray/precheck.js --base origin/main 看重複程式碼和沒人用的檔案；要 Codex 再審一次就 /codex:rescue 或 codex exec -s read-only -C <worktree> \'$fe-code-review 審這個分支，跳過爆炸半徑\'；不用 Codex 就 /mission-skip code-review:codex <理由>',
          tracks: [
            {
              id: 'claude',
              label: 'Claude',
              matchSkill: ['code-review', 'cr', 'fe-code-review'],
              hint: 'Claude 還沒審：輸入 /mattpocock-skills:code-review（改動大或風險高再改用 /cr），順便跑 node ~/.claude/scripts/jev-xray/precheck.js --base origin/main 健檢',
            },
            {
              id: 'codex',
              label: 'Codex',
              // matchSkillExact 不去掉前綴比對——否則隨便哪個 plugin 剛好有一個叫 rescue
              // 的 skill 都會被誤認成 Codex 審查。
              matchSkillExact: 'codex:rescue',
              matchAgentPrefix: 'codex:',
              matchBash: ['codex review', 'codex exec'],
              // 合併前 codex-review 是獨立節點，舊資料的 skip key 沒有冒號；併進來後要當
              // 這條軌道被跳過，不然舊任務重新接回會變成還要再審一次。
              legacySkipIds: ['codex-review'],
              hint: 'Codex 還沒審：叫 /codex:rescue 用 $fe-code-review 審這個分支、跳過爆炸半徑，或直接跑 codex exec -s read-only -C <worktree> \'$fe-code-review 審這個分支，跳過爆炸半徑\'（codex review 的 --base 不能跟 prompt 一起用）；不用就 /mission-skip code-review:codex <理由>',
            },
          ],
        },
      ],
    },
    {
      id: 'verify',
      label: '驗收',
      nodes: [
        {
          id: 'acceptance-run',
          label: 'verify-acceptance',
          matchSkill: 'verify-acceptance',
          doneWhen: 'acceptance-run',
          hint: mission =>
            mission.acceptance?.exists === true
              ? '輸入 /verify-acceptance 逐條驗收'
              : '先跑 /to-acceptance，再跑 /verify-acceptance；舊任務不需要就 /mission-skip acceptance-run <理由>',
        },
        {
          id: 'regression-write',
          label: 'verify-acceptance/regression',
          doneWhen: 'regression-write',
          hint: '有「回歸：是」的 AC 要補寫回歸測試，寫完到清單把回歸入庫改成已寫',
        },
        {
          id: 'overall-regression',
          label: 'verify-acceptance/overall',
          doneWhen: 'overall-regression',
          // 跟 acceptance-run 不一樣：這裡沒有驗收清單也還是擋著（整體回歸本身不能跳過用
          // 「沒資料就放過」），只是舊任務提示改成直接講怎麼跳過這個節點。
          hint: mission =>
            mission.acceptance?.exists === true
              ? '/verify-acceptance 跑整體回歸（commit 後）'
              : '沒有驗收清單的舊任務：/mission-skip overall-regression <理由>',
        },
        {
          id: 'blast-radius',
          matchRead: 'pstack:blast-radius',
          hint: '讀過 pstack 的 blast-radius 判準，確認改動的爆炸半徑',
        },
        {
          id: 'interrogate',
          optional: true,
          matchRead: 'pstack:interrogate',
          hint: '有把握可以跳過；不確定自己講不講得出改動原因就讀 pstack 的 interrogate',
        },
      ],
    },
    {
      id: 'review',
      label: '審查',
      nodes: [
        {
          id: 'open-mr',
          matchSkill: ['push', 'fe-mr-generator'],
          doneWhen: 'mr',
          hint: '輸入 /push 開 MR',
        },
        {
          id: 'freeze-spec',
          doneWhen: 'issue-note',
          hint: '/push 開完 MR 會接著把 spec 凍結到 issue 留言；MR 已經開過就再跑一次 /push 選「僅推送」補發；沒有對應 issue 或 spec 就 /mission-skip freeze-spec <理由>',
        },
        {
          id: 'mr-reading-map',
          matchSkill: 'mr-reading-map',
          skipWhen: mission => (mission.review?.approved === true ? 'MR 已核准，不用再發閱讀地圖' : undefined),
          hint: mission =>
            `輸入 /mr-reading-map ${latestMrIid(mission) ?? '<MR 號>'} 發閱讀地圖；skill 會先判斷這個 MR 需不需要，不需要會直接告訴你。確定不需要就 /mission-skip mr-reading-map <理由>`,
        },
        {
          id: 'await-review',
          doneWhen: 'await-review',
          hint: '等同事看過之後，跑 /mission-review 同步 MR 狀態',
        },
        {
          id: 'reverify',
          label: 'verify-acceptance/overall',
          skipWhen: reverifySkipReason,
          doneWhen: 'reverify',
          hint: '改完 code 或 rebase 之後，要重跑 /verify-acceptance 的整體回歸',
        },
        {
          id: 'push-fix',
          doneWhen: 'push-fix',
          hint: '本機跟遠端不一致就要 push；rebase 過要 force-push，請用 `! git push --force-with-lease` 自己執行，跑完再 /mission-review 同步',
        },
        {
          id: 'reply',
          doneWhen: 'reply',
          hint: '逐則回覆或標 resolved；用 glab api 發討論回覆才會被記到，貼留言框不算',
        },
        {
          id: 'approved',
          doneWhen: 'approved',
          hint: '跑 /mission-review 同步核准狀態',
        },
      ],
    },
    {
      id: 'finish',
      label: '收尾',
      nodes: [
        {
          id: 'retro',
          matchSkill: 'retro',
          hint: '輸入 /retro 回顧這次 session',
        },
        {
          id: 'correct',
          optional: true,
          matchRead: 'pstack:correct',
          hint: '有把握可以跳過；不確定就讀 pstack 的 correct',
        },
      ],
    },
  ],
} as const
