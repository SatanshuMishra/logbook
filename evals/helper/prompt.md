---
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Edit, Write, Glob, Grep, Skill, ToolSearch, ListMcpResourcesTool, ReadMcpResourceTool, Agent]
---

On the logbook thread flaky-checkout, send a general-purpose helper agent to find every place under src/ that reads HTTP_TIMEOUT_MS, with the file and line of each. Then tell me exactly what the helper reported.
