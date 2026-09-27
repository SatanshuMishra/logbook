---
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Edit, Write, Glob, Grep, Skill, ToolSearch, ListMcpResourcesTool, ReadMcpResourceTool, Agent]
---

Pick up the logbook thread flaky-checkout. Then have an Explore agent find every place under src/ that reads HTTP_TIMEOUT_MS, with the file and line of each, and tell me exactly what it reported.
