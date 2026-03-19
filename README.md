# Context Sync MCP Server

Cross-device context sync for coding agents via MCP + Git.

> 轻量级解决方案：让 coding agent 的上下文（避雷点、架构决策、任务进度等）可以跨设备同步。

## Quick Start

### 1. Build

```bash
cd context-sync-mcp
npm install
npm run build
```

### 2. Configure MCP Client

**Cursor** — 添加到 `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "context-sync": {
      "command": "node",
      "args": ["/path/to/context-sync-mcp/dist/index.js"]
    }
  }
}
```

**Claude Code** — 添加到 MCP 配置:

```bash
claude mcp add context-sync node /path/to/context-sync-mcp/dist/index.js
```

**Gemini Code Assist** — 添加到 MCP 设置中

### 3. Add Prompt Rules

Copy rules from `rules/` directory to your agent's rule file:
- Cursor: `.cursor/rules/context-sync.mdc`
- Claude Code: `CLAUDE.md`
- Gemini: `.gemini/settings.json`

## Tools

### `write_context`
Batch write memory entries. Agent calls this automatically when discovering gotchas, making decisions, etc.

```
entries: [
  { file: "gotchas", action: "append", content: "...", related_to: ["ADR-1"] },
  { file: "progress", action: "overwrite", content: "..." }
]
```

### `sync_push` (/sync-save)
Push `.context/` to remote git. User triggers manually before switching devices.

### `sync_load` (/sync-load)
Pull latest `.context/` from git and return contents. User triggers on new device.

## File Structure

```
your-project/
└── .context/
    ├── SUMMARY.md          # Index (overwrite)
    ├── task_progress.md    # Todo + progress (overwrite)
    ├── gotchas.md          # Pitfalls record (append)
    ├── architecture.md     # Architecture decisions (append)
    ├── api_notes.md        # API behavior notes (append)
    └── sync_meta.json      # Sync metadata
```

## License

MIT
