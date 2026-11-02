import { latestMrIid, reverifySkipReason } from '../hooks/review-stage'
import { reviewTriageSkipReason } from '../hooks/review-triage'
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
          hint: '在同一段對話輸入 /to-spec，把討論整理成 spec 草稿（先放 scratchpad，拿到 RD 票號再寫進 .claude/specs/spec-<iid>-<描述>.md）',
        },
        {
          id: 'gitlab-issue',
          matchSkill: 'gitlab-issue',
          hint: '輸入 /gitlab-issue 把 spec 草稿嵌進 RD 票：已有 RD 票就更新描述（先備份），只有 PM 票就新開 RD 票並跑 ~/.claude/scripts/gitlab/issue-status.sh "<專案路徑>" <iid> "Ready to develop"；拿到 iid 後把 spec 寫進 .claude/specs/spec-<iid>-<描述>.md，任務名稱是 PM 票號的話用 /mission-rename 改成 RD 票號；舊任務不需要就 /mission-skip gitlab-issue <理由>',
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
          hint: '先跑 ~/.claude/scripts/gitlab/resolve-base-branch.sh "<專案路徑>" <iid> 決定基底（issue 的 milestone 有對應的 rc 分支就用 rc），再跟 AI 說「orca worktree create --base-branch origin/<輸出>」請它建（不要加 !，band 是從 AI 跑的指令記下路徑），建好後請它跑 ~/.claude/scripts/gitlab/issue-status.sh "<專案路徑>" <iid> "Developing"，再自己用 ! cp <主 checkout>/apps/<app>/.env <worktree>/apps/<app>/.env 把要用到的 app 的 .env 複製過去（AI 不碰 .env；少了它驗收會整輪受阻）；打勾後 /mission-next，再 /mission-go 開新分頁',
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
          id: 'interrogate',
          optional: true,
          // 手打 /pstack:interrogate 記成 skill 事件，直接讀 SKILL.md 才是 read 事件，兩種都要認
          matchSkillExact: 'pstack:interrogate',
          matchRead: 'pstack:interrogate',
          hint: '大票才跑（非測試檔超過 10 個、或動到共用模組、狀態流程）：在 code-review 之前跑一次 /pstack:interrogate 先問前提，finding 照樣存檔跑 /review-triage，確認的修完就進 code-review；每張票只跑這一次，之後不再重跑。小票就 /mission-skip interrogate <理由>',
        },
        {
          // Codex 不是獨立的一步，是 code review 的第二意見，所以跟 Claude 的審查併成同一個
          // 節點的兩條軌道，而不是後面接著的另一個節點；兩條都跑過、或 Codex 被跳過，才算完成。
          id: 'code-review',
          hint: '實作完輸入 /mattpocock-skills:code-review 審 Spec、Standards 兩軸，第一輪順便跑 node ~/.claude/scripts/jev-xray/precheck.js --base origin/main 看重複程式碼和沒人用的檔案；要 Codex 再審一次就 /codex:rescue 用 $codex-evidence-review 審，或 codex exec -s read-only -C <worktree> \'$codex-evidence-review 審這個分支（base origin/main），附 spec 與驗收清單路徑\'；不用 Codex 就 /mission-skip code-review:codex <理由>。兩道都交回後，請 Claude 把原始 finding 存檔再跑 /review-triage 判定，確認的才派修；改善、防禦性建議收進這張功能票的後續票，修正範圍外的確認 bug 交你決定。修完重審兩道都只看這一輪的修正（base 換成上一輪 HEAD，派工照 templates.md 模板 5b），不再整支重審',
          tracks: [
            {
              id: 'claude',
              label: 'Claude',
              matchSkill: 'code-review',
              hint: 'Claude 還沒審：第一輪輸入 /mattpocock-skills:code-review 審整個分支，順便跑 node ~/.claude/scripts/jev-xray/precheck.js --base origin/main 健檢；修完重審只給審查者 <上一輪 HEAD>..HEAD 和上一輪確認項（照 templates.md 模板 5b），不再整支審、也不再跑 precheck',
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
              hint: 'Codex 還沒審：叫 /codex:rescue 用 $codex-evidence-review 審這個分支，或直接跑 codex exec -s read-only -C <worktree> \'$codex-evidence-review 審這個分支（base origin/main），附 spec 與驗收清單路徑\'（codex review 的 --base 不能跟 prompt 一起用）；修完重審時把範圍換成 <上一輪 HEAD>..HEAD 並附上一輪確認項；不用就 /mission-skip code-review:codex <理由>',
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
          matchSkillExact: 'pstack:blast-radius',
          matchRead: 'pstack:blast-radius',
          hint: '讀過 pstack 的 blast-radius 判準，確認改動的爆炸半徑',
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
          hint: '/push 開完 MR 會接著把 spec 凍結到 issue 留言；MR 已經開過就再跑一次 /push 選「僅推送」補發。留言發了還沒打勾，多半是任務名稱沒有 issue 號，用 /mission-rename 補上；真的沒有 issue 或 spec 才 /mission-skip freeze-spec <理由>',
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
          id: 'followup',
          optional: true,
          hint: 'review-triage 有收進後續票的項目：開這張功能票的後續 RD 票，從原分支切 stacked 分支開新任務、開 draft MR 接著做（不等原 MR 合併；原 MR 有修正就 merge 進來，不 rebase；後續 MR 一樣照「第一輪整支、修完只審修正」的審查規則）。這個節點偵測不到完成，開好後續票或確定不用都 /mission-skip followup <理由>。沒有後續項目就 /mission-skip followup <理由>',
        },
        {
          id: 'review-triage',
          matchSkill: 'review-triage',
          skipWhen: reviewTriageSkipReason,
          doneWhen: 'review-triage',
          hint: 'reviewer 有新留言：請 Claude 把還沒處理的留言照貼存成 finding 檔（標 note id），再跑 /review-triage 判定，判完才修或回覆',
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
          hint: '輸入 /mattpocock-skills:retro 回顧這次 session',
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
