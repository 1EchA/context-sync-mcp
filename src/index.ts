#!/usr/bin/env node

/**
 * Context Sync MCP Server
 * 
 * Provides 4 tools for cross-device coding agent context synchronization:
 * 1. write_context — batch write memory entries to .context/ files
 * 2. sync_init — bootstrap .context/ for a new project
 * 3. sync_push — git add + commit + push .context/
 * 4. sync_load — git pull + read .context/ files
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeContext } from "./tools/write-context.js";
import { syncInit } from "./tools/sync-init.js";
import { syncPush } from "./tools/sync-push.js";
import { syncLoad } from "./tools/sync-load.js";

const server = new McpServer({
  name: "context-sync",
  version: "0.1.1",
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

// --- Tool 2: sync_init ---
server.tool(
  "sync_init",
  "Bootstrap Context Sync for a project that has not been initialized yet. Use for first-time setup requests such as /sync-init, 'init context', 'initialize sync', or 'set up context sync for this repo'. If context already exists, do not overwrite it; guide the user to /sync-load instead.",
  {
    progress: z.string().optional().describe("Optional: initial task_progress.md content to seed the project."),
    summary: z.string().optional().describe("Optional: initial SUMMARY.md content to seed the project."),
    auto_push: z.boolean().optional().describe("Optional: whether to automatically perform the first sync_push after bootstrapping. Defaults to true."),
    project_path: z.string().optional().describe("Optional: absolute path to the target project. If omitted, uses CONTEXT_SYNC_PROJECT_PATH env var or current working directory."),
  },
  async ({ progress, summary, auto_push, project_path }) => {
    return await syncInit(progress, summary, project_path, auto_push ?? true);
  }
);

// --- Tool 3: sync_push ---
server.tool(
  "sync_push",
  "Push local .context/ files to remote git. Auto-generates SUMMARY.md. Use only for save/upload/push requests such as /sync-save, 'sync push', 'save context', or 'upload context'. Do NOT use this tool for pull/load/restore/new-device recovery requests.",
  {
    summary: z.string().optional().describe("Optional: custom SUMMARY.md content. If omitted, auto-generated from existing context files."),
    project_path: z.string().optional().describe("Optional: absolute path to the target project. If omitted, uses CONTEXT_SYNC_PROJECT_PATH env var or current working directory."),
  },
  async ({ summary, project_path }) => {
    return await syncPush(summary, project_path);
  }
);

// --- Tool 4: sync_load ---
server.tool(
  "sync_load",
  "Pull latest .context/ files from remote git and return their contents. Use for load/pull/restore/recover requests such as /sync-load, 'sync pull', 'pull context', 'load context', or 'restore context on a new device'. Do NOT use sync_push for these requests.",
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
