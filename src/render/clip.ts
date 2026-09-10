import { clipGraphemes, clipGraphemesFloor } from './escape.ts'

export const CLIP_MARKER = '...[shortened]'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

export const CLIP_MARKER_GRAPHEMES = graphemeCount(CLIP_MARKER)

const isClipBudget = (max: number): boolean =>
  max === Number.POSITIVE_INFINITY || (Number.isFinite(max) && max >= 0)

export const clipWithMarker = (text: string, max: number): string => {
  if (!isClipBudget(max)) {
    throw new Error(
      `clipWithMarker received a max of ${String(max)}, which is not a clip budget; pass a non-negative finite grapheme count, or Number.POSITIVE_INFINITY to clip nothing.`
    )
  }
  if (!Number.isFinite(max)) return text
  if (graphemeCount(text) <= max) return text
  const budget = max - CLIP_MARKER_GRAPHEMES
  if (budget <= 0) return clipGraphemes(CLIP_MARKER, Math.max(0, max))
  return `${clipGraphemes(text, budget)}${CLIP_MARKER}`
}

export const clipWithMarkerFloor = (text: string, min: number): string => {
  if (!isClipBudget(min)) {
    throw new Error(
      `clipWithMarkerFloor received a min of ${String(min)}, which is not a clip budget; pass a non-negative finite grapheme count, or Number.POSITIVE_INFINITY to clip nothing.`
    )
  }
  if (!Number.isFinite(min)) return text
  const total = graphemeCount(text)
  if (total <= min) return text
  const budget = min - CLIP_MARKER_GRAPHEMES
  const candidate =
    budget <= 0 ? clipGraphemesFloor(CLIP_MARKER, Math.max(0, min)) : `${clipGraphemesFloor(text, budget)}${CLIP_MARKER}`
  return graphemeCount(candidate) >= total ? text : candidate
}
