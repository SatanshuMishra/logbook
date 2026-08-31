import { clipGraphemes } from './escape.ts'

export const CLIP_MARKER = '...[shortened]'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

export const CLIP_MARKER_GRAPHEMES = graphemeCount(CLIP_MARKER)

export const clipWithMarker = (text: string, max: number): string => {
  if (!Number.isFinite(max)) return text
  if (graphemeCount(text) <= max) return text
  const budget = max - CLIP_MARKER_GRAPHEMES
  if (budget <= 0) return clipGraphemes(CLIP_MARKER, Math.max(0, max))
  return `${clipGraphemes(text, budget)}${CLIP_MARKER}`
}
