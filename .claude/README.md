# .claude/ — 專案層級的 Claude Code 設定

claude-skills 是**公開** repo，commit 前有一道 guard 把兩件事擋在前面。

⚠️ **這個目錄不再是整包不進版控。** 機制本身（guard 腳本、範本、hook 接線、本檔）會進版控，只有實際的敏感詞清單與個人偏好留在本地。**要放公司相關資訊之前先確認該檔案是否被 `.gitignore` 排除。**

## commit-guard 在做什麼

`hooks/commit-guard.sh` 掛在 PreToolUse（matcher `Bash`），只對 `git commit` 生效：

1. **作者身份** — 避免用公司帳號簽到公開 repo
2. **敏感詞** — 掃 staged diff 與 commit message，命中就擋

### 檢查範圍

- commit 指令本身（`-m` 的 message、heredoc 內容都在裡面）
- `git diff --cached`（這次要提交的 staged 變更）
- 用了 `-a` / `--all` 時，額外掃未 staged 的變更

只掃「這次要提交的東西」，不掃整個工作區，所以無關檔案不會誤報。

## 啟用（clone 後兩步）

沒做這兩步不會卡住任何操作，guard 只是不生效。

```bash
# 1. 敏感詞清單
cp .claude/commit-denylist.example.txt .claude/commit-denylist.txt
# 編輯它，填入實際要擋的詞

# 2. 允許的作者信箱
git config commitguard.email you@example.com
```

兩者都刻意留在本地：清單列著它要保護的東西，信箱是個人資料。

## 進版控 vs 本地

| 檔案 | 版控 | 說明 |
|------|------|------|
| `hooks/commit-guard.sh` | ✅ | 機制本身，跟著 repo 走 |
| `commit-denylist.example.txt` | ✅ | 範本與說明 |
| `settings.json` | ✅ | hook 接線 |
| `README.md` | ✅ | 本檔 |
| `commit-denylist.txt` | ❌ | 實際清單 |
| `settings.local.json` | ❌ | 個人偏好與 permissions |
| `worktrees/` | ❌ | 本地產物 |

## 被擋了怎麼辦

hook 會列出命中的詞與出現位置。把措辭改成泛用描述後重新 commit——具體 repo 名改成「monorepo」、業務區塊名改成「前台／後台」之類。若某個詞其實不敏感，從 `commit-denylist.txt` 移除該行。

## 失效模式（設計時的取捨）

| 狀況 | 行為 | 為什麼 |
|------|------|--------|
| 沒有 `commit-denylist.txt` | 放行 + 每次印提示 | clone 後還沒設定是正常狀態，不該卡死；印提示是為了讓「以為有防護但其實沒有」無所遁形 |
| 清單存在但讀不到 | **擋下** | 設定壞掉不等於沒設定 |
| 清單裡沒有任何有效詞 | 放行 + 印提示 | 同上 |
| 沒設 `commitguard.email` | 跳過身份檢查 | 沒設定就不管 |
| hook 本身出錯 | 放行 | 不讓 guard 的 bug 癱瘓整個 session |

## 已知摩擦

**任何含 `git commit` 字樣的 Bash 指令都會進檢查**，包括分支名帶 `commit` 的 `git merge`、以及你想拿敏感詞去 grep 的除錯指令。多數情況會正常放行，只是多繞一圈。

真的需要在指令裡帶敏感詞除錯時，**不要在對話裡把該詞拆字拼接**——那只是騙過字面比對，詞本身還是留在紀錄裡。改用 `grep -f` 從清單讀取，或分成兩條指令跑。

## 它擋不住什麼

guard 掃的是字面比對，擋得住「寫錯字」，擋不住刻意規避（改寫、縮寫、拼音、拆字）。它是防手滑的網子，不是資安機制。

## 歷史脈絡

2026-07-21 曾用 `git filter-repo` 洗掉全部 73 個 commit 中的公司／專案名並 force-push。GitHub 上的舊 object 仍可用舊 SHA 存取（需要開 ticket 請 GitHub Support 清），目前決定先放著。這個 hook 就是為了避免再發生一次。
