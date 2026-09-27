---
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Edit, Write, Glob, Grep, Skill, ToolSearch, ListMcpResourcesTool, ReadMcpResourceTool]
---

Pick up the logbook thread flaky-checkout. Its current next step is already done. Set the thread's next step to raising HTTP_TIMEOUT_MS in src/config.ts from 2000 to 5000, then carry that step out.
