import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Refusal } from '../schema/declare.ts'

export type RefusalPayload = {
  ok: false
  field: string
  accepted: string
  example: string
  retryable: boolean
  message: string
}

export const refusalPayload = (r: Refusal): RefusalPayload => ({
  ok: false,
  field: r.field,
  accepted: r.accepted,
  example: r.example,
  retryable: r.retryable,
  message: r.message
})

const renderRefusalText = (payload: RefusalPayload): string =>
  [
    `field: ${payload.field}`,
    `accepted: ${payload.accepted}`,
    `example: ${payload.example}`,
    `retryable: ${payload.retryable}`,
    payload.message
  ].join('\n')

export const toolRefusal = (r: Refusal): CallToolResult => {
  const payload = refusalPayload(r)
  return {
    isError: true,
    content: [{ type: 'text', text: renderRefusalText(payload) }]
  }
}

export const toolOk = <T>(text: string, structured: T): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structured as Record<string, unknown>
})
