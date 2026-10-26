// /mission-link 與 /mission-unlink 的引數解析與指令邏輯；跟 model.ts 分開放避免它繼續長下去。
import type { Missions } from '../types'
import { ASSETS_CAP, removeAsset, setManualAsset } from './assets'
import { type CommandOutcome, findBoundMission } from './model'

export type ParsedLink = { label: string; url: string } | { error: string }

export function parseLinkArgs(args: string): ParsedLink {
  const trimmed = args.trim()
  const spaceIndex = trimmed.indexOf(' ')
  if (trimmed === '' || spaceIndex === -1) return { error: '用法：/mission-link <標籤> <網址>' }
  const label = trimmed.slice(0, spaceIndex)
  const url = trimmed.slice(spaceIndex + 1).trim()
  if (url === '') return { error: '用法：/mission-link <標籤> <網址>' }
  return { label, url }
}

export type ParsedUnlink = { label: string } | { error: string }

export function parseUnlinkArgs(args: string): ParsedUnlink {
  const label = args.trim()
  if (label === '') return { error: '用法：/mission-unlink <標籤>' }
  return { label }
}

export function linkAsset(missions: Missions, binding: string, label: string, url: string, now: number): CommandOutcome {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return { ok: false, text: '這裡沒有綁定任務' }

  const [name, mission] = bound
  const updated = setManualAsset(mission, label, url, now)
  if (updated === mission) return { ok: false, text: `資產已達 ${ASSETS_CAP} 筆上限，請先 /mission-unlink 清掉幾筆` }

  return { ok: true, missions: { ...missions, [name]: updated }, text: `已加入「${label}」` }
}

export function unlinkAsset(missions: Missions, binding: string, label: string): CommandOutcome {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return { ok: false, text: '這裡沒有綁定任務' }

  const [name, mission] = bound
  const updated = removeAsset(mission, label)
  if (updated === mission) return { ok: false, text: `找不到標籤「${label}」` }

  return { ok: true, missions: { ...missions, [name]: updated }, text: `已刪除「${label}」` }
}
