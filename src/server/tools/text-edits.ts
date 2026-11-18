import { z } from 'zod'
import { NOTE_HEADING } from '../../doc/document.ts'
import { oneLine } from '../../doc/render.ts'
import type { Ok, Refusal } from '../../schema/declare.ts'

const NOT_BLANK = /\S/
const OLD_TEXT_ACCEPTED = "text copied exactly from the thread's stored document that occurs there exactly once"
const OLD_TEXT_EXAMPLE = 'The form renders but submitting it fails.'

export const filledText = (description: string) => z.string().regex(NOT_BLANK).describe(description)

export const TextEditSchema = z
  .strictObject({
    old_text: z
      .string()
      .min(1)
      .describe(
        "text copied exactly from the thread's stored document, as it stands after the earlier edits; refused when empty, when the document does not hold it, or when it occurs more than once"
      ),
    new_text: z.string().describe('the text that replaces old_text; empty to delete old_text')
  })
  .describe('one exact-text replacement in the stored document')

export type TextEdit = z.infer<typeof TextEditSchema>

export const editsInput = (applied: string) =>
  z
    .array(TextEditSchema)
    .optional()
    .describe(
      `replacements applied in order to the stored document ${applied}, each old_text occurring exactly once in the text as it stands after the earlier edits`
    )

export const noteInput = () =>
  z
    .array(filledText('one line of the note; refused when empty or only whitespace'))
    .optional()
    .describe(
      `lines written after the call's summary line under "## ${NOTE_HEADING}" and in the commit, such as "Removed: D2 because it was reversed"`
    )

const editField = (index: number): string => `edits.${index}.old_text`

const oldTextAbsent = (index: number): Refusal => ({
  ok: false,
  field: editField(index),
  accepted: OLD_TEXT_ACCEPTED,
  example: OLD_TEXT_EXAMPLE,
  retryable: true,
  message: `the old_text of edit ${index} was not found in the stored document as it stands after the earlier edits, so nothing was committed; copy the text exactly from the thread's document`
})

const oldTextRepeated = (index: number, occurrences: number): Refusal => ({
  ok: false,
  field: editField(index),
  accepted: OLD_TEXT_ACCEPTED,
  example: OLD_TEXT_EXAMPLE,
  retryable: true,
  message: `the old_text of edit ${index} occurs ${occurrences} times in the stored document as it stands after the earlier edits, so nothing was committed; include more of the surrounding text so it occurs once`
})

const occurrencesOf = (text: string, part: string): number => text.split(part).length - 1

const replaceOnce = (text: string, edit: TextEdit, index: number): Ok<string> | Refusal => {
  const occurrences = occurrencesOf(text, edit.old_text)
  if (occurrences === 0) return oldTextAbsent(index)
  if (occurrences > 1) return oldTextRepeated(index, occurrences)
  const at = text.indexOf(edit.old_text)
  return { ok: true, value: `${text.slice(0, at)}${edit.new_text}${text.slice(at + edit.old_text.length)}` }
}

export const withTextEdits = (text: string, edits: readonly TextEdit[]): Ok<string> | Refusal =>
  edits.reduce<Ok<string> | Refusal>(
    (state, edit, index) => (state.ok ? replaceOnce(state.value, edit, index) : state),
    { ok: true, value: text }
  )

export const noteLinesOf = (note: readonly string[] | undefined): string[] => (note ?? []).map(oneLine)
