// renderSegment／renderRow／stepsBox：把 band.ts 算好的資料（BandRow／BandSegment）畫成
// Box／Text／Link。只吃呼叫端從 $.ui.resolve(e) 解出來的這三個元素，不碰 $ 本身——跟
// register.tsx 分開放單純是為了省行數（register.tsx 貼著 400 行上限），不是這裡有什麼
// 跟 $ 相關的邏輯。
import type { BoxProps, ElementConstructor, LinkProps, TextProps } from 'claude-code'

import type { BandRow, BandSegment } from './band'

export type RenderElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Link: ElementConstructor<LinkProps>
}

function renderSegment({ Text, Link }: RenderElements, segment: BandSegment, key: string) {
  return segment.href === undefined ? (
    <Text key={key} color={segment.color} bold={segment.bold} dimColor={segment.dim} wrap="truncate-end">
      {segment.text}
    </Text>
  ) : (
    <Link key={key} href={segment.href}>
      {segment.text}
    </Link>
  )
}

// 有 width 的欄位（步驟符號、資產列點）包一層固定寬度的 Box，同一欄每一列都對齊，
// 文字長度不同也不會把後面的欄位擠歪。
export function renderRow(elements: RenderElements, row: BandRow) {
  const { Box } = elements
  return (
    <Box key={row.key} flexDirection="row" gap={1}>
      {row.segments.map((segment, i) => {
        const key = `${row.key}-${i}`
        if (segment.width === undefined) return renderSegment(elements, segment, key)
        return (
          <Box key={key} width={segment.width} flexShrink={0}>
            {renderSegment(elements, segment, `${key}-inner`)}
          </Box>
        )
      })}
    </Box>
  )
}

// 引擎的 Box 沒有邊框內嵌標題（無法畫出 ╭ 步驟 ─╮ 那種樣式），改成框內第一行放粗體的
// 「步驟」字樣。只有兩框並排時才限制步驟框寬度，單獨一框（steps-only）時沒有旁邊的資產框
// 要分寬度，給滿版。
export function stepsBox(elements: RenderElements, steps: readonly BandRow[], width: string | undefined) {
  const { Box, Text } = elements
  return (
    <Box key="steps" flexDirection="column" borderStyle="round" width={width}>
      <Text bold>步驟</Text>
      {steps.map(row => renderRow(elements, row))}
    </Box>
  )
}
