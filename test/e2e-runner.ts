/**
 * End-to-end test runner for context-sync-mcp
 *
 * Usage:
 *   1. npm run build  (compile the project)
 *   2. cd test/sandbox && node ../e2e-runner.js
 *
 * The script must run from a git-initialized directory with a remote.
 */

import { writeContext } from "../dist/tools/write-context.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ── Helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function section(title: string) {
  const pad = Math.max(0, 60 - title.length);
  console.log(`\n── ${title} ${"─".repeat(pad)}`);
}

async function readLocalFile(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), "utf-8");
}

/** Clean up .context/ directory to start fresh */
async function cleanContext() {
  try {
    await rm(join(process.cwd(), ".context"), { recursive: true, force: true });
  } catch {
    // ignore
  }
  // Also un-stage & remove from git so sync_push sees clean state
  try {
    execSync("git rm -rf --cached .context 2>/dev/null || true", { stdio: "pipe" });
    execSync("git commit -m 'clean context for test' --allow-empty 2>/dev/null || true", { stdio: "pipe" });
  } catch {
    // ignore
  }
}

// ── Tests ────────────────────────────────────────────────────────────

async function testWriteContextAppend() {
  section("Test 1: write_context append (gotchas, auto-numbering #1)");

  const result = await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: "## SQLite WAL 问题\n- **现象**：多进程同时写入报 SQLITE_BUSY\n- **解决**：使用 journal_mode=DELETE",
    },
  ]);

  const text = result.content[0].text;
  assert(text.includes("✅ Appended to gotchas"), "Returns success message");

  const fileContent = await readLocalFile(".context/gotchas.md");
  assert(fileContent.includes("# 避雷点"), "File has header");
  assert(fileContent.includes("## 1. SQLite WAL"), "Auto-numbered as ## 1.");
}

async function testWriteContextAppendSecond() {
  section("Test 2: write_context append (second entry, auto-numbering #2)");

  const result = await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: "## Next.js Middleware 限制\n- **现象**：Edge Runtime 不支持 Node.js API",
    },
  ]);

  const text = result.content[0].text;
  assert(text.includes("✅ Appended to gotchas"), "Returns success message");

  const fileContent = await readLocalFile(".context/gotchas.md");
  assert(fileContent.includes("## 1. SQLite WAL"), "First entry preserved");
  assert(fileContent.includes("## 2. Next.js Middleware"), "Auto-numbered as ## 2.");
}

async function testWriteContextRelatedTo() {
  section("Test 3: write_context append with related_to");

  await writeContext([
    {
      file: "architecture",
      action: "append",
      content: "## 数据库选择 SQLite\n- **决策**：使用 SQLite\n- **原因**：单机应用，部署简单",
      related_to: ["ADR-1", "踩坑#1"],
    },
  ]);

  const fileContent = await readLocalFile(".context/architecture.md");
  assert(fileContent.includes("[ADR-1](architecture.md#adr-1)"), "ADR link generated");
  assert(fileContent.includes("[踩坑#1](gotchas.md#1)"), "Gotcha link generated");
  assert(fileContent.includes("**关联**"), "Related-to section present");
}

async function testWriteContextOverwrite() {
  section("Test 4: write_context overwrite (progress)");

  // First write
  await writeContext([
    {
      file: "progress",
      action: "overwrite",
      content: "# 任务进度\n- [x] 步骤1\n- [ ] 步骤2\n- [ ] 步骤3",
    },
  ]);

  let fileContent = await readLocalFile(".context/task_progress.md");
  assert(fileContent.includes("- [x] 步骤1"), "First write correct");
  assert(fileContent.includes("- [ ] 步骤2"), "First write has pending items");

  // Overwrite
  await writeContext([
    {
      file: "progress",
      action: "overwrite",
      content: "# 任务进度\n- [x] 步骤1\n- [x] 步骤2\n- [ ] 步骤3",
    },
  ]);

  fileContent = await readLocalFile(".context/task_progress.md");
  assert(fileContent.includes("- [x] 步骤2"), "Overwrite updated step 2");
}

async function testWriteContextOverwriteSummary() {
  section("Test 5: write_context overwrite (summary)");

  await writeContext([
    {
      file: "summary",
      action: "overwrite",
      content: "# 项目上下文索引\n\n## 当前状态\n认证模块重构 70%",
    },
  ]);

  const fileContent = await readLocalFile(".context/SUMMARY.md");
  assert(fileContent.includes("项目上下文索引"), "Summary file written");
  assert(fileContent.includes("认证模块重构 70%"), "Summary content correct");
}

async function testWriteContextBatch() {
  section("Test 5b: write_context batch (multiple entries at once)");

  await writeContext([
    {
      file: "api_notes",
      action: "append",
      content: "## /api/users\n- POST: 不支持批量创建",
    },
    {
      file: "api_notes",
      action: "append",
      content: "## /api/auth/refresh\n- 有 rate limit，1分钟最多5次",
    },
  ]);

  const fileContent = await readLocalFile(".context/api_notes.md");
  assert(fileContent.includes("/api/users"), "First batch entry written");
  assert(fileContent.includes("/api/auth/refresh"), "Second batch entry written");
}

async function testSyncPush() {
  section("Test 6: sync_push (git commit + push)");

  const result = await syncPush();
  const text = result.content[0].text;

  assert(
    text.includes("✅ Context synced successfully") || text.includes("✅ Committed locally"),
    "Returns success message",
    text
  );

  // Verify git log shows context sync commit
  const gitLog = execSync("git log --oneline -3", { encoding: "utf-8" });
  assert(gitLog.includes("context sync:"), "Git commit message contains 'context sync:'");

  // Verify remote has the commit
  const remoteLog = execSync(
    `git --git-dir=${join(process.cwd(), "../remote.git")} log --oneline -3`,
    { encoding: "utf-8" }
  );
  assert(remoteLog.includes("context sync:"), "Remote repo has the commit");

  // Verify sync_meta.json was created
  const meta = await readLocalFile(".context/sync_meta.json");
  const metaObj = JSON.parse(meta);
  assert(metaObj.last_sync !== undefined, "sync_meta.json has last_sync");
  assert(metaObj.device !== undefined, "sync_meta.json has device");
}

async function testSyncPushNoChanges() {
  section("Test 6b: sync_push (no changes)");

  const result = await syncPush();
  const text = result.content[0].text;
  assert(
    text.includes("No changes to push") || text.includes("✅"),
    "Handles no-change case gracefully",
    text
  );
}

async function testSyncLoadAll() {
  section("Test 7: sync_load (all files)");

  const result = await syncLoad(undefined);
  const text = result.content[0].text;

  assert(text.includes("Context restored"), "Returns restored message");
  assert(text.includes("SUMMARY.md"), "Contains SUMMARY");
  assert(text.includes("task_progress.md"), "Contains progress");
  assert(text.includes("gotchas.md"), "Contains gotchas");
  assert(text.includes("architecture.md"), "Contains architecture");
  assert(text.includes("api_notes.md"), "Contains api_notes");

  // Verify priority order: summary should appear before gotchas
  const summaryIdx = text.indexOf("SUMMARY.md");
  const gotchasIdx = text.indexOf("gotchas.md");
  assert(summaryIdx < gotchasIdx, "SUMMARY loaded before gotchas (priority order)");
}

async function testSyncLoadTopic() {
  section("Test 8: sync_load (specific topic)");

  const result = await syncLoad("gotchas");
  const text = result.content[0].text;

  assert(text.includes("gotchas.md"), "Returns gotchas file");
  assert(text.includes("SQLite WAL"), "Contains gotcha content");
  assert(!text.includes("SUMMARY.md"), "Does NOT contain other files");
}

async function testSyncLoadNoContext() {
  section("Test 9: sync_load (no .context directory)");

  // Remove .context/ temporarily
  await rm(join(process.cwd(), ".context"), { recursive: true, force: true });

  const result = await syncLoad(undefined);
  const text = result.content[0].text;

  assert(
    text.includes("No sync context found") || text.includes("No `.context/`"),
    "Returns no-context message",
    text
  );
}

async function testSyncLoadNoGit() {
  section("Test 10: sync_load (no git repo)");

  // Run from /tmp which is not a git repo
  const origCwd = process.cwd();
  process.chdir("/tmp");

  const result = await syncLoad(undefined);
  const text = result.content[0].text;

  assert(
    text.includes("New Device Setup Guide") || text.includes("No git repository"),
    "Returns new device guide",
    text
  );

  // Restore cwd
  process.chdir(origCwd);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   Context Sync MCP — End-to-End Test Runner         ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n📂 Working directory: ${process.cwd()}`);

  // Pre-flight: verify we're in the sandbox
  const cwd = process.cwd();
  if (!cwd.includes("sandbox")) {
    console.error("⚠️  Warning: Expected to run from test/sandbox/ directory");
  }

  // Clean up any previous test artifacts
  await cleanContext();

  try {
    // write_context tests
    await testWriteContextAppend();
    await testWriteContextAppendSecond();
    await testWriteContextRelatedTo();
    await testWriteContextOverwrite();
    await testWriteContextOverwriteSummary();
    await testWriteContextBatch();

    // sync_push tests
    await testSyncPush();
    await testSyncPushNoChanges();

    // sync_load tests
    await testSyncLoadAll();
    await testSyncLoadTopic();
    await testSyncLoadNoContext();
    await testSyncLoadNoGit();
  } catch (error: any) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    console.error(error.stack);
    failed++;
  }

  // Summary
  console.log("\n══════════════════════════════════════════════════════");
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("══════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main();
