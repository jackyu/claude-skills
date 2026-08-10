/**
 * pre-commit 檢查（搭配 husky）
 *
 * 只跑在 staged 檔案上，所以動不到的舊檔不會被拖下水。
 * 門檻依據見 fe-guardrails/references/thresholds.md。
 */

export default {
  '*.{ts,tsx,js,jsx,mjs,cjs}': [
    // 先自動修能修的，剩下的才報出來
    'eslint --fix',
  ],

  '*.{json,md,css}': ['prettier --write'],
}

/*
 * 收緊時要改的地方
 * ────────────────
 * 既有專案第一版的規則是 warn，所以上面這樣寫「看得到但不會擋」。
 * 依 baseline-strategy.md 第四步準備收緊時，把該行改成：
 *
 *   'eslint --fix --max-warnings=0'
 *
 * 效果是：舊檔不碰就不管，但只要你改到某個檔，那個檔就得零 warning。
 *
 * 副作用要先知道：改一支 500 行大檔的一行，整個檔的 warning 都會擋住你。
 * 所以先確認大檔的 warning 數量在可接受範圍，再開這個開關。
 *
 * 為什麼 tsc 與 jscpd 不放這裡
 * ──────────────────────────
 * tsc --noEmit 是全專案編譯，放 pre-commit 每次要等十幾秒到一分鐘，
 * 大家會開始用 --no-verify 繞過去，反而更糟。放 pre-push 或 CI。
 *
 * jscpd 抓的是跨檔重複，只掃 staged 檔沒有意義。同樣放 CI。
 */
