// /mission-list 與 /mission-log 的文字格式化；跟 model.ts 分開放避免它繼續長下去。
import type { Missions, MissionFlow } from '../types'
import { findBoundMission, isSessionBinding, nodeStates, stageAt, stageLabelFor } from './model'

const STORE_SIZE_WARNING_BYTES = 2 * 1024 * 1024

// JSON 字元數只是位元組數的近似值（中文在 UTF-8 下會更大），但這裡只是提醒用的門檻，不必精確。
function approximateStoreBytes(missions: Missions): number {
  return JSON.stringify(missions).length
}

export function listMissionsText(missions: Missions, binding: string, flow: MissionFlow): string {
  const names = Object.keys(missions).sort()
  const header =
    names.length === 0
      ? '目前沒有任務'
      : names
          .map(name => {
            const mission = missions[name]
            if (mission === undefined) return undefined
            const stage = stageAt(flow, mission.stage)
            const states = nodeStates(stage.nodes, mission)
            const done = states.filter(s => s.status === 'done' || s.status === 'skip').length
            const marker = mission.binding === binding ? '　← 目前' : ''
            const where = isSessionBinding(mission.binding) ? '主 checkout（分析中）' : mission.binding
            return `${name}　${stageLabelFor(stage, mission)}　${done}/${states.length}　${where}${marker}`
          })
          .filter((line): line is string => line !== undefined)
          .join('\n')

  const bytes = approximateStoreBytes(missions)
  if (bytes <= STORE_SIZE_WARNING_BYTES) return header

  const sizeMb = (bytes / (1024 * 1024)).toFixed(1)
  return `${header}\n\n⚠ 任務資料已經 ${sizeMb} MiB，考慮對不再需要的任務跑 /mission-finish`
}

export function missionLogText(missions: Missions, binding: string): string {
  const bound = findBoundMission(missions, binding)
  if (bound === undefined) return '這裡沒有綁定任務'

  const [, mission] = bound
  if (mission.events.length === 0) return '還沒有事件'

  return mission.events
    .map(event => {
      const line = `${event.kind} ${event.name} ${event.agentId ?? 'main'} ${new Date(event.at).toISOString()}`
      const missing = event.missingSections
      const withMissing = missing !== undefined && missing.length > 0 ? `${line}　缺：${missing.join('、')}` : line
      // review-sync 事件帶 round：/mission-log 看歷史輪次，見 hooks/review-events.ts 的 syncReview。
      return event.round === undefined ? withMissing : `${withMissing}　第 ${event.round} 輪`
    })
    .join('\n')
}
