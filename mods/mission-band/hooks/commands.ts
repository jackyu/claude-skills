// /mission-* 指令的註冊清單；跟 register.tsx 分開放單純是為了省 register.tsx 的行數
// （它貼著 400 行的上限），不是這裡有什麼邏輯——純資料，session.start 迴圈呼叫
// $.command.register 逐筆註冊。
import type { CommandSpec } from 'claude-code'

export const MISSION_COMMANDS: readonly CommandSpec[] = [
  { name: 'mission-start', description: '開始追蹤一個任務流程（名稱自動加日期）', argumentHint: '#<issue> | <名稱>' },
  { name: 'mission-list', description: '列出所有任務' },
  { name: 'mission-restore', description: '把任務接到這個 session 或 worktree', argumentHint: '#<issue> | <名稱>' },
  { name: 'mission-skip', description: '跳過目前階段的一個節點，或雙軌節點（例如 code-review）底下的一條軌道', argumentHint: '<nodeId>[:<track>] <理由>' },
  { name: 'mission-next', description: '進入下一個階段' },
  { name: 'mission-go', description: '在任務的 worktree 開新 claude 分頁並接回任務' },
  { name: 'mission-finish', description: '清除綁定在這裡的任務', argumentHint: '[name] [--force]' },
  { name: 'mission-log', description: '列出綁定在這裡的任務事件' },
  { name: 'mission-link', description: '手動加入或覆蓋一筆資產', argumentHint: '<標籤> <網址>' },
  { name: 'mission-unlink', description: '刪除一筆資產', argumentHint: '<標籤>' },
  { name: 'mission-cost', description: '量任務各階段的 token 用量（/mission-finish 也會先量一次）', argumentHint: '[#<issue> | <名稱>] [--sessions <id>,<id>]' },
  { name: 'mission-review', description: '同步審查階段的 MR 狀態、核准、討論回饋' },
  { name: 'mission-help', description: '開啟 mission-band 使用說明教學頁（band 右上角「?」按鈕同效果）' },
]
