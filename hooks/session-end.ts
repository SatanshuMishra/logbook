#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { writeHandover } from '../src/thread/handover.ts'
import { addTranscript, heldBy } from '../src/thread/holds.ts'

const CLEAR_REASON = 'clear'

await runHook('session-end', ({ event, sessionId, paths, rt }) => {
  if (event.reason !== CLEAR_REASON) return {}
  const slug = heldBy(paths, sessionId)
  const transcript = typeof event.transcript_path === 'string' && event.transcript_path !== '' ? event.transcript_path : null
  if (slug !== null && transcript !== null) addTranscript(rt, paths, slug, transcript)
  writeHandover(rt, paths, { session: sessionId, slug, transcript, at: rt.now() })
  return {}
})
