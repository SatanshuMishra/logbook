---
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Edit, Write, Glob, Grep, Skill, ToolSearch, ListMcpResourcesTool, ReadMcpResourceTool]
---

Slow payment gateway responses are failing checkout. Raise HTTP_TIMEOUT_MS in src/config.ts to 5000.
