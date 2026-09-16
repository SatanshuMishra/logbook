export type ConflictPath = { path: string; base_blob: string | null; local_blob: string | null; remote_blob: string | null }

export type ConflictState = { local_commit: string; remote_commit: string; paths: ConflictPath[] }

export type ConflictReportEntry = ConflictPath & { local_changes: string[] | null; remote_changes: string[] | null }
