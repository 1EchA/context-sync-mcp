/**
 * Deep edge-case tests for context-sync-mcp
 *
 * Tests potential bugs found during code audit:
 * 1. Batch append to SAME file in one call (race condition)
 * 2. findLastNumber false positive on content body
 * 3. sync_push only commits .context/ files (not other staged changes)
 * 4. write_context with empty content string
 * 5. write_context append to progress/summary (non-numbered files)
 * 6. sync_load after git pull --rebase with uncommitted .context changes
 * 7. Concurrent write_context calls (data loss)
 * 8. write_context content without ## header (auto-numbering edge case)
 */

import { writeContext } from "../dist/tools/write-context.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import { findLastNumber, formatRelatedTo } from "../dist/utils.js";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;
const bugs: string[] = [];

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    const msg = `${label}${detail ? " — " + detail : ""}`;
    console.log(`  ❌ ${msg}`);
    failed++;
    bugs.push(msg);
  }
}

function section(title: string) {
  const pad = Math.max(0, 65 - title.length);
  console.log(`\n── ${title} ${"─".repeat(pad)}`);
}

async function readLocalFile(relativePath: string): Promise<string> {
  return readFile(join(process.cwd(), relativePath), "utf-8");
}

async function cleanContext() {
  try {
    await rm(join(process.cwd(), ".context"), { recursive: true, force: true });
  } catch { /* ignore */ }
  try {
    execSync("git rm -rf --cached .context 2>/dev/null || true", { stdio: "pipe" });
    execSync("git commit -m 'clean' --allow-empty 2>/dev/null || true", { stdio: "pipe" });
  } catch { /* ignore */ }
}

// ── Test Cases ───────────────────────────────────────────────────────

async function testBatchAppendSameFile() {
  section("Bug 1: Batch append to SAME file in one write_context call");
  // If we append two entries to "gotchas" in the same batch,
  // the second read will NOT see the first write (both read the initial state)
  // This could cause the first entry to be lost.

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: "## Bug Alpha\n- First bug entry",
    },
    {
      file: "gotchas",
      action: "append",
      content: "## Bug Beta\n- Second bug entry",
    },
  ]);

  const content = await readLocalFile(".context/gotchas.md");
  const hasAlpha = content.includes("Bug Alpha");
  const hasBeta = content.includes("Bug Beta");

  assert(hasAlpha, "First batch entry 'Bug Alpha' preserved");
  assert(hasBeta, "Second batch entry 'Bug Beta' preserved");

  if (hasAlpha && hasBeta) {
    // Check auto-numbering is correct
    assert(content.includes("## 1."), "First entry numbered as ## 1.");
    assert(content.includes("## 2."), "Second entry numbered as ## 2.");
  }
}

async function testFindLastNumberFalsePositive() {
  section("Bug 2: findLastNumber false positive in content body");
  // Content that has "## 99." in a code block or inline text
  // should still be matched (this is expected behavior, but worth verifying)

  const contentWithCodeBlock = `# Gotchas

## 1. Real Entry
Some text

\`\`\`markdown
## 99. This is inside a code block
\`\`\`

## 2. Another Entry
More text`;

  const num = findLastNumber(contentWithCodeBlock);
  // Note: findLastNumber uses /^## (\d+)\./gm which will match ## 99. inside code block
  // because ^ in multiline mode matches start of any line
  // This is a known limitation but let's document it
  console.log(`  ℹ️  findLastNumber returns ${num} (matches inside code blocks too)`);
  if (num === 99) {
    console.log("  ⚠️  WARNING: Code block content affects numbering — potential false positive");
    bugs.push("findLastNumber matches ## N. inside code blocks (could cause number gaps)");
  }
  // This is more of a documentation item than a test failure
  passed++;
}

async function testSyncPushScopedCommit() {
  section("Bug 3: sync_push should only commit .context/ changes");
  // Create a non-.context file and stage it, then run sync_push
  // Verify it doesn't commit the non-.context file

  await writeFile(join(process.cwd(), "unrelated-file.txt"), "I should not be committed by sync_push\n");
  execSync("git add unrelated-file.txt", { stdio: "pipe" });

  // Write some context to ensure there's a .context change
  await writeContext([
    { file: "summary", action: "overwrite", content: "# Test Summary\nCommit scoping test" },
  ]);

  await syncPush();

  // Check git log for the last commit
  const lastCommitFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", { encoding: "utf-8" });
  const hasUnrelated = lastCommitFiles.includes("unrelated-file.txt");

  assert(!hasUnrelated,
    "sync_push does NOT accidentally commit non-.context files",
    hasUnrelated ? `Committed: ${lastCommitFiles.trim()}` : undefined
  );

  // Clean up: unstage and remove the unrelated file
  execSync("git reset HEAD unrelated-file.txt 2>/dev/null || true", { stdio: "pipe" });
  execSync("rm -f unrelated-file.txt", { stdio: "pipe" });
}

async function testWriteContextEmptyContent() {
  section("Bug 4: write_context with empty/whitespace content");

  const result = await writeContext([
    { file: "api_notes", action: "append", content: "" },
  ]);

  // Empty content should now be skipped with a descriptive message
  const text = result.content[0].text;
  assert(text.includes("Skipped") || text.includes("⏩"),
    "Empty append returns skip message",
    text.split("\n")[0]
  );
}

async function testWriteContextAppendProgress() {
  section("Bug 5: write_context append to non-numbered file (api_notes)");
  // api_notes uses append but is NOT in the auto-numbering list
  // Make sure numbering is NOT applied

  await writeContext([
    { file: "api_notes", action: "overwrite", content: "# API Notes" },
  ]);

  await writeContext([
    { file: "api_notes", action: "append", content: "## /api/users\n- GET returns paginated" },
  ]);

  const content = await readLocalFile(".context/api_notes.md");
  assert(!content.includes("## 1. /api/users"),
    "api_notes entries are NOT auto-numbered",
    content.includes("## 1.") ? "Found ## 1. in api_notes (should not be numbered)" : undefined
  );
  assert(content.includes("## /api/users"), "api_notes entry written correctly");
}

async function testWriteContextContentNoHeader() {
  section("Bug 6: write_context append without ## header (auto-numbering edge case)");
  // If agent sends content without a ## header, the auto-numbering replace() will do nothing
  // Make sure it doesn't break

  await cleanContext();

  await writeContext([
    { file: "gotchas", action: "append", content: "No header here, just plain text about a bug" },
  ]);

  const content = await readLocalFile(".context/gotchas.md");
  assert(content.includes("No header here"), "Content without ## header is still appended");
  assert(content.includes("# 避雷点"), "Header is still present");
}

async function testFormatRelatedToEdgeCases() {
  section("Bug 7: formatRelatedTo edge cases");

  // Empty array
  assert(formatRelatedTo([]) === "", "Empty array returns empty string");

  // Unknown format
  const unknown = formatRelatedTo(["RandomID"]);
  assert(unknown.includes("[RandomID]"), "Unknown ID format uses fallback bracket syntax");

  // Mixed types
  const mixed = formatRelatedTo(["ADR-1", "踩坑#2", "CustomRef"]);
  assert(mixed.includes("architecture.md"), "ADR link points to architecture.md");
  assert(mixed.includes("gotchas.md"), "Gotcha link points to gotchas.md");
  assert(mixed.includes("[CustomRef]"), "Custom ref uses fallback");
}

async function testSyncPushRepeatedNoChange() {
  section("Bug 8: sync_push twice in a row (no-change after initial push)");

  await cleanContext();

  // First: write + push
  await writeContext([
    { file: "summary", action: "overwrite", content: "# Summary\nTest double push" },
  ]);
  const result1 = await syncPush();
  assert(result1.content[0].text.includes("✅"), "First push succeeds");

  // Second: push again with no changes
  const result2 = await syncPush();
  assert(result2.content[0].text.includes("No changes"),
    "Second push correctly reports no changes",
    result2.content[0].text
  );
}

async function testGitPullRebaseConflict() {
  section("Bug 9: sync_load with local uncommitted .context changes");
  // If there are local uncommitted .context changes, git pull --rebase will fail
  // sync_load should still return local files gracefully

  // Write local context but don't push
  await writeContext([
    { file: "gotchas", action: "append", content: "## Local-only gotcha\n- Not pushed yet" },
  ]);

  // sync_load should still work (it catches pull errors)
  const result = await syncLoad(undefined);
  const text = result.content[0].text;
  assert(text.includes("Context restored") || text.includes("gotcha"),
    "sync_load works even with uncommitted local changes",
    text.substring(0, 100)
  );
}

async function testLargeContent() {
  section("Bug 10: write_context with very large content");
  // Verify no truncation or buffer issues

  const largeContent = "## Large Entry\n" + "- Line of content that is reasonably long\n".repeat(500);
  await writeContext([
    { file: "gotchas", action: "append", content: largeContent },
  ]);

  const content = await readLocalFile(".context/gotchas.md");
  const lineCount = content.split("\n").length;
  assert(lineCount > 500, `Large content preserved (${lineCount} lines)`, `Expected >500 lines`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Context Sync MCP — Deep Edge-Case Bug Audit           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n📂 Working directory: ${process.cwd()}`);

  await cleanContext();

  try {
    await testBatchAppendSameFile();
    await testFindLastNumberFalsePositive();
    await testSyncPushScopedCommit();
    await testWriteContextEmptyContent();
    await testWriteContextAppendProgress();
    await testWriteContextContentNoHeader();
    await testFormatRelatedToEdgeCases();
    await testSyncPushRepeatedNoChange();
    await testGitPullRebaseConflict();
    await testLargeContent();
  } catch (error: any) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    console.error(error.stack);
    failed++;
    bugs.push(`Unexpected crash: ${error.message}`);
  }

  // Summary
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (bugs.length > 0) {
    console.log(`\n🐛 Bugs found (${bugs.length}):`);
    bugs.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
  }
  console.log("══════════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main();
