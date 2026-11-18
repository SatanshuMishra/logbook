#!/usr/bin/env node
import { enableCompileCache } from 'node:module'

enableCompileCache()

const { runHook } = await import('./lib/io.ts')
const { recordEvent, writeThreadSummary } = await import('../src/metrics/record.ts')
const { writeHandover } = await import('../src/thread/handover.ts')
const { addTranscript, heldBy } = await import('../src/thread/holds.ts')

const CLEAR_REASON = 'clear'

await runHook('session-end', ({ event, sessionId, paths, rt }) => {
  const slug = heldBy(paths, sessionId)
  if (event.reason === CLEAR_REASON) {
    const transcript = typeof event.transcript_path === 'string' && event.transcript_path !== '' ? event.transcript_path : null
    if (slug !== null && transcript !== null) addTranscript(rt, paths, slug, transcript)
    writeHandover(rt, paths, { session: sessionId, slug, transcript, at: rt.now() })
    if (slug !== null) recordEvent(rt, paths, slug, 'thread.handover', {})
  }
  if (slug !== null) writeThreadSummary(rt, paths, slug)
  return {}
})
