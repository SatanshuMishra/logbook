export type SectionGrade = {
  ok: boolean
  reasons: readonly string[]
  firstTurnLength: number
  finalLength: number
}

const STANDS_LINE = '## Where things stand'
const HEADING_PREFIX = '## '
const NOT_STARTED = 'Not started.'
const BOUND = 2

export const whereThingsStand = (documentText: string): string => {
  const lines = documentText.split('\n').map((line) => line.replace(/\r$/, ''))
  const start = lines.indexOf(STANDS_LINE)
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith(HEADING_PREFIX))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}

const missing = (body: string): boolean => body === '' || body === NOT_STARTED

export const gradeSection = (input: { firstTurn: string; final: string }): SectionGrade => {
  const firstTurnBody = whereThingsStand(input.firstTurn)
  const finalBody = whereThingsStand(input.final)
  const firstTurnLength = firstTurnBody.length
  const finalLength = finalBody.length
  const reasons = [
    ...(missing(firstTurnBody) ? ['Where things stand at the end of the first turn is empty or Not started.'] : []),
    ...(missing(finalBody) ? ['the final Where things stand is empty or Not started.'] : []),
    ...(finalLength > BOUND * firstTurnLength
      ? [
          `the final Where things stand is ${finalLength} characters, more than twice the ${firstTurnLength} of the first turn`
        ]
      : [])
  ]
  return { ok: reasons.length === 0, reasons, firstTurnLength, finalLength }
}
