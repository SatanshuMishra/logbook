import { parseDocument } from './document.ts'

export type UpdateReason =
  | { kind: 'milestone'; detail: string }
  | { kind: 'turn-changed' }
  | { kind: 'blocked-user-wrote'; status: string }

export const UPDATE_RULES: readonly string[] = [
  'Describe the present only.',
  'Where things stand says only where the work is now: a finished step leaves it, and its proof goes on the criterion it ticks as evidence.',
  'As the document grows, finished-step detail in Where things stand gives way first, then decisions and risks that no longer constrain future work.',
  'Where the details live names each file or document once with what it holds, never the steps or commits that changed it.',
  'State each fact in one place only, in as few words as hold it.',
  'No timeline and no clock times.',
  'Tick a criterion only with "evidence: <what proves it>".',
  'Strike a criterion only with [~] and "struck: <reason>".',
  'Never delete a criterion.',
  'Reword a criterion only citing the new decision that changed it.',
  'Keep a decision or a risk only while it still constrains future work; otherwise remove it, or move it to Settled, do not reopen under a new id.',
  'Remove every line that belongs to an option the owner did not take.',
  'New ids start at the Next ids numbers and no number is reused.',
  'End with a last section "## This update" holding one line that says what changed and one line "Removed: <id> because <reason>" for each id you removed.'
]

export const REQUEST_CEILING = 9500

export const REASON_LIMIT = 300

const INSTRUCTION_LINE =
  'Read that file first if you have not read it in this context, then change it with the Edit tool and do not print the document.'
const OPEN_CRITERIA_HEADING = 'Open criteria:'
const NO_OPEN_CRITERIA = 'No open criteria.'
const RULES_HEADING = 'Rules:'
const CUT_MARK = '...'

const RULE_BLOCK: readonly string[] = [RULES_HEADING, ...UPDATE_RULES.map((rule) => `- ${rule}`)]

const moreCriteriaLine = (count: number): string => `(${count} more open criteria are under Done when in the file.)`

const cutToLimit = (text: string): string =>
  text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}${CUT_MARK}` : text

const reasonLine = (reason: UpdateReason, cut: boolean): string => {
  const fit = (text: string): string => (cut ? cutToLimit(text) : text)
  switch (reason.kind) {
    case 'milestone':
      return `Reason: a milestone finished: ${fit(reason.detail)}.`
    case 'turn-changed':
      return 'Reason: the turn changed something.'
    case 'blocked-user-wrote':
      return `Reason: blocked or waiting and the user wrote. The status is "${fit(reason.status)}"; if the user's message settled it, update the Status line.`
  }
}

const openCriteriaLines = (documentText: string): string[] =>
  parseDocument(documentText)
    .items.filter((item) => item.letter === 'c' && item.box === ' ')
    .map((item) => `- ${item.id} ${item.text}`)

const criteriaBlock = (shown: readonly string[], dropped: number): string[] =>
  shown.length === 0 && dropped === 0
    ? [NO_OPEN_CRITERIA]
    : [OPEN_CRITERIA_HEADING, ...shown, ...(dropped > 0 ? [moreCriteriaLine(dropped)] : [])]

const requestLines = (path: string, reason: string, shown: readonly string[], dropped: number): string[] => [
  `logbook: update the state document at ${path}.`,
  reason,
  INSTRUCTION_LINE,
  ...criteriaBlock(shown, dropped),
  ...RULE_BLOCK
]

const joinedLength = (lines: readonly string[]): number => lines.reduce((total, line) => total + line.length + 1, -1)

type Fit = { kept: number; used: number; open: boolean }

const keptCriteria = (criteria: readonly string[], frameLength: (dropped: number) => number): number =>
  criteria.slice(0, -1).reduce<Fit>(
    (fit, line) => {
      if (!fit.open) return fit
      const kept = fit.kept + 1
      const used = fit.used + line.length + 1
      return frameLength(criteria.length - kept) + used <= REQUEST_CEILING
        ? { kept, used, open: true }
        : { ...fit, open: false }
    },
    { kept: 0, used: 0, open: true }
  ).kept

export const updateRequest = (input: { path: string; documentText: string; reason: UpdateReason }): string => {
  const criteria = openCriteriaLines(input.documentText)
  const reason = reasonLine(input.reason, false)
  const full = requestLines(input.path, reason, criteria, 0)
  if (joinedLength(full) <= REQUEST_CEILING) return full.join('\n')
  const frameLength = (dropped: number): number => joinedLength(requestLines(input.path, reason, [], dropped))
  if (frameLength(criteria.length) > REQUEST_CEILING) {
    return requestLines(input.path, reasonLine(input.reason, true), [], criteria.length).join('\n')
  }
  const kept = keptCriteria(criteria, frameLength)
  return requestLines(input.path, reason, criteria.slice(0, kept), criteria.length - kept).join('\n')
}

export const tidyRequest = (input: { path: string; documentText: string }): string =>
  [
    `logbook: the state document at ${input.path} was converted from the old ledger. Rewrite it with the Edit tool under these rules, keeping every id, and do not print it.`,
    ...RULE_BLOCK
  ].join('\n')
