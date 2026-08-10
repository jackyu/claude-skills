/**
 * 品質護欄規則（ESLint flat config）
 *
 * 用法：在專案的 eslint.config.mjs 最後展開，蓋在既有設定之上
 *
 *   import guardrails from './eslint-guardrails.mjs'
 *   export default [
 *     ...你原本的設定,
 *     ...guardrails({ mode: 'existing' }),
 *   ]
 *
 * 門檻依據見 fe-guardrails/references/thresholds.md。
 * 既有專案別直接用 mode: 'new'，先跑 apply.sh --measure 量現況。
 *
 * 這裡只給規則，不給 parser。
 * .ts/.tsx 要能被解析，得靠專案既有的 config 提供 parser
 * （Next.js 專案通常來自 eslint-config-next，其他專案是 typescript-eslint）。
 * 專案沒有 TS parser 的話，這些規則對 .ts/.tsx 一行都不會生效——
 * eslint 會先在 parsing error 就停住，看起來像規則沒作用。
 * 所以務必展開在既有 config「之後」，不要單獨拿來當整份 config 用。
 */

/** 建議值。既有專案會被 mode 降成 warn，數字另外用 overrides 調 */
const DEFAULTS = {
  tsFunctionLines: 50,
  // JSX 撐行數，跟邏輯複雜度不是同一回事，所以跟 .ts 分開算
  tsxFunctionLines: 150,
  complexity: 15,
  maxDepth: 4,
  maxLines: 200,
}

/**
 * @param {object} [options]
 * @param {'new'|'existing'} [options.mode] existing 一律降成 warn，先看得到、不卡工作流
 * @param {Partial<typeof DEFAULTS>} [options.overrides] 用 --measure 量到的實際值覆寫
 * @param {string[]} [options.ignores] 額外排除的路徑
 */
export default function guardrails(options = {}) {
  const { mode = 'existing', overrides = {}, ignores = [] } = options
  const t = { ...DEFAULTS, ...overrides }
  const level = mode === 'new' ? 'error' : 'warn'

  // 空行與註解不算進行數，否則會逼人寫得更擠、更難讀
  const lineCountOpts = { skipBlankLines: true, skipComments: true }

  const shared = {
    complexity: [level, t.complexity],
    'max-depth': [level, t.maxDepth],
    'max-lines': [level, { max: t.maxLines, ...lineCountOpts }],
  }

  return [
    ...(ignores.length ? [{ ignores }] : []),
    {
      files: ['**/*.{ts,mts,cts,js,mjs,cjs}'],
      rules: {
        ...shared,
        'max-lines-per-function': [
          level,
          { max: t.tsFunctionLines, ...lineCountOpts },
        ],
      },
    },
    {
      // 放在 .ts 區塊之後，同名規則以後者為準
      files: ['**/*.{tsx,jsx}'],
      rules: {
        ...shared,
        'max-lines-per-function': [
          level,
          { max: t.tsxFunctionLines, ...lineCountOpts },
        ],
      },
    },
    {
      // 測試檔的 describe 區塊天生就長，套函式長度門檻只會製造噪音
      files: [
        '**/__tests__/**',
        '**/*.{test,spec}.{ts,tsx,js,jsx}',
        '**/*.stories.{ts,tsx}',
      ],
      rules: {
        'max-lines-per-function': 'off',
        'max-lines': 'off',
      },
    },
  ]
}

export { DEFAULTS }
