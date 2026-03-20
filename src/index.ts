#!/usr/bin/env node

/**
 * Context Sync MCP Server
 * 
 * Provides 3 tools for cross-device coding agent context synchronization:
 * 1. write_context — batch write memory entries to .context/ files
 * 2. sync_push — git add + commit + push .context/
 * 3. sync_load — git pull + read .context/ files
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeContext } from "./tools/write-context.js";
import { syncPush } from "./tools/sync-push.js";
import { syncLoad } from "./tools/sync-load.js";

const server = new McpServer({
  name: "context-sync",
  version: "0.1.0",
});

// --- Tool 1: write_context ---
server.tool(
  "write_context",
  "Batch write memory entries to .context/ files. Supports append (for gotchas, architecture, api_notes) and overwrite (for progress, summary). Use this to record discoveries, decisions, and progress during development.",
  {
    entries: z.array(z.object({
      file: z.enum(["gotchas", "architecture", "api_notes", "progress", "summary"]),
      action: z.enum(["append", "overwrite"]),
      content: z.string().describe("Markdown formatted content to write"),
      related_to: z.array(z.string()).optional().describe("Optional related entry IDs for lightweight associations, e.g. ['ADR-1', 'Gotcha#2']"),
    })).describe("Array of entries to write"),
    project_path: z.string().optional().describe("Optional: absolute path to the target project. If omitted, uses CONTEXT_SYNC_PROJECT_PATH env var or current working directory."),
  },
  async ({ entries, project_path }) => {
    return await writeContext(entries, project_path);
  }
);

// --- Tool 2: sync_push ---
server.tool(
  "sync_push",
  "Push local .context/ files to remote git. Auto-generates SUMMARY.md. Use when user triggers /sync-save to sync context across devices.",
  {
    summary: z.string().optional().describe("Optional: custom SUMMARY.md content. If omitted, auto-generated from existing context files."),
    project_path: z.string().optional().describe("Optional: absolute path to the target project. If omitted, uses CONTEXT_SYNC_PROJECT_PATH env var or current working directory."),
  },
  async ({ summary, project_path }) => {
    return await syncPush(summary, project_path);
  }
);

// --- Tool 3: sync_load ---
server.tool(
  "sync_load",
  "Pull latest .context/ files from remote git and return their contents. Use when user triggers /sync-load to restore context on a new device.",
  {
    topic: z.string().optional().describe("Optional: load only a specific topic file"),
    project_path: z.string().optional().describe("Optional: absolute path to the target project. If omitted, uses CONTEXT_SYNC_PROJECT_PATH env var or current working directory."),
  },
  async ({ topic, project_path }) => {
    return await syncLoad(topic, project_path);
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  // Use stderr.write with prefix to avoid MCP stdio protocol confusion
  process.stderr.write(`[context-sync-mcp] Fatal: ${error.message}\n`);
  process.exit(1);
});
