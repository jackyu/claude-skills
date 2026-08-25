# fe-show-me

用最小的視覺形式（pseudocode、call tree、component tree、file tree、Mermaid、diff、單頁 HTML）把重點講清楚，取代大段文字說明。

## 解決什麼問題

架構討論、MR review、issue 拆解時，一大段文字常常沒有一張 call tree 或一份 diff 講得清楚。這個 skill 讓 agent 依情境挑最小的視覺形式表達重點，而不是預設寫長文。

## 與原始版本的差異

改編自 [humanlayer/skills 的 show-me](https://github.com/humanlayer/skills/blob/3c2629142c5d437428269b1b722b08c0b87f574d/plugins/show-me/skills/show-me/SKILL.md)（純 prompt、無腳本、無 `allowed-tools`）。原始版本在 HTML 產出這塊有三個沒防住的洞，本版補上：

| 項目 | 原始版本 | fe-show-me |
|---|---|---|
| 資料 | 「use real labels and data」 | 一律用假資料／佔位資料，禁止真實客戶、帳號、金額、身分資訊 |
| CDN | 未限制 | 必須 self-contained，禁止外部 CDN，樣式全部 inline |
| 輸出路徑 | 未指定（`path/to/` 佔位符） | 固定 `.claude/tmp/show-me-{description}.html`，並確保加進 `.gitignore` |
| 開啟方式 | `Bash(open path/to/...)`（macOS-only） | 不主動執行，改為印出絕對路徑讓使用者自行開啟 |

七種視覺形式（pseudocode／call tree／component tree／file tree／Mermaid／diff／HTML）與原版一致，diff 要對應主題形狀（改元件 diff component tree、改目錄 diff file tree）的判準也保留。

## 適用情境

- 架構討論或設計決策需要畫圖講清楚
- MR review 要表達「這次改動的形狀」而非貼整包程式碼
- PM issue 拆解要跟非工程背景的人講技術架構
- 用戶直接要求畫圖、視覺化、show me

## 安全邊界

- HTML 產出禁止放真實業務資料
- HTML 產出禁止引用外部 CDN 或發外部請求
- HTML 產出只能落在 `.claude/tmp/`，不寫進 repo 原始碼路徑
- 不主動執行任何開啟檔案的指令

## 安裝

```bash
./scripts/install.sh -s fe-show-me
```

## 使用範例

```
這個金流狀態機的流程幫我畫一下
```

```
這個 MR 動到哪些元件，show me 一下
```
