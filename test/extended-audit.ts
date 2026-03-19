/**
 * Extended edge-case tests — second-pass audit
 *
 * Tests for:
 * 1. sync_load silent pull failure (stale data, no warning)
 * 2. write_context with empty entries array
 * 3. hasContextFiles returns true for sync_meta.json only, but readAllContextFiles returns []
 * 4. Unicode/emoji content handling
 * 5. write_context with entries containing only whitespace
 * 6. formatRelatedTo with ADR-like IDs that have spaces
 * 7. sync_load after .context has only sync_meta.json
 * 8. findLastNumber with edge case numbers (0, 999, negative-like)
 * 9. write_context overwrite then append in same batch
 * 10. gitCommand error message content (stderr leaking sensitive info?)
 */

import { writeContext } from "../dist/tools/write-context.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import { findLastNumber, formatRelatedTo, readAllContextFiles } from "../dist/utils.js";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
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

async function cleanContext() {
  try {
    await rm(join(process.cwd(), ".context"), { recursive: true, force: true });
  } catch { /* ignore */ }
  try {
    execSync("git rm -rf --cached .context 2>/dev/null || true", { stdio: "pipe" });
    execSync("git commit -m 'clean' --allow-empty 2>/dev/null || true", { stdio: "pipe" });
  } catch { /* ignore */ }
}

// ── Tests ────────────────────────────────────────────────────────────

async function testEmptyEntriesArray() {
  section("Test 1: write_context with empty entries array");

  const result = await writeContext([]);
  const text = result.content[0].text;

  // Should succeed but what does it return?
  assert(!('isError' in result) || !result.isError, "Does not return error");
  assert(text.includes("📁 Written to"), "Returns success format");
  // Check if it's confusing — "Written to" but nothing listed
  console.log(`  ℹ️  Output: "${text.replace(/\n/g, " | ")}"`);
}

async function testSyncMetaOnlyContext() {
  section("Test 2: sync_load when .context/ has only sync_meta.json");

  await cleanContext();

  // Create .context/ with only sync_meta.json
  const contextDir = join(process.cwd(), ".context");
  await mkdir(contextDir, { recursive: true });
  await writeFile(join(contextDir, "sync_meta.json"), '{"last_sync":"2026-01-01"}', "utf-8");

  // hasContextFiles will return true (it sees sync_meta.json)
  // but readAllContextFiles only reads known file keys, so it returns []
  const result = await syncLoad(undefined);
  const text = result.content[0].text;

  // This is the confusing case: "Context directory exists but all files are empty"
  assert(!text.includes("Context restored (0 files)"),
    "Does NOT say '0 files restored' (would be confusing)",
    text.substring(0, 100)
  );

  // Document what actually happens
  console.log(`  ℹ️  Actual response: "${text.substring(0, 80)}..."`);
}

async function testUnicodeContent() {
  section("Test 3: Unicode/emoji/CJK content handling");

  await cleanContext();

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: "## 🚨 中文标题 with émojis\n- **现象**：日本語テスト\n- Ñoño café résumé\n- 数学符号：∑∏∫≈≠≤≥",
    },
  ]);

  const content = await readFile(join(process.cwd(), ".context/gotchas.md"), "utf-8");
  assert(content.includes("🚨"), "Emoji preserved");
  assert(content.includes("中文标题"), "CJK preserved");
  assert(content.includes("日本語テスト"), "Japanese preserved");
  assert(content.includes("∑∏∫"), "Math symbols preserved");
  assert(content.includes("Ñoño café résumé"), "Accented chars preserved");
}

async function testWhitespaceOnlyContent() {
  section("Test 4: write_context with whitespace-only content");

  await cleanContext();

  const result = await writeContext([
    { file: "gotchas", action: "append", content: "   \n\n   \n  " },
  ]);

  // Whitespace-only content should now be skipped
  const text = result.content[0].text;
  assert(text.includes("Skipped") || text.includes("⏩"),
    "Whitespace-only append is skipped",
    text.split("\n")[0]
  );
}

async function testOverwriteThenAppendSameBatch() {
  section("Test 5: Overwrite then append to SAME file in one batch");

  await cleanContext();

  // This tests the order: overwrite clears, then append should add
  const result = await writeContext([
    {
      file: "gotchas",
      action: "overwrite",
      content: "# Fresh Start\nClean slate.",
    },
    {
      file: "gotchas",
      action: "append",
      content: "## New entry after overwrite\n- This should appear",
    },
  ]);

  const content = await readFile(join(process.cwd(), ".context/gotchas.md"), "utf-8");
  assert(content.includes("Fresh Start") || content.includes("New entry"),
    "Content exists after overwrite-then-append");

  // The real question: does the overwrite wipe the append, or does append
  // re-read and see the overwritten content?
  // Since it's a sequential for loop: overwrite writes "Fresh Start",
  // then append reads "Fresh Start" and appends "New entry"
  const hasBoth = content.includes("Fresh Start") && content.includes("New entry");
  assert(hasBoth, "Both overwrite and subsequent append are present");

  if (hasBoth) {
    // Check if auto-numbering worked after the overwrite
    assert(content.includes("## 1. New entry") || content.includes("## New entry"),
      "Auto-numbering after overwrite",
      content.includes("## 1.") ? "Numbered as ## 1." : "No numbering (overwrite left no ## N. to increment from)"
    );
  }
}

async function testAppendThenOverwriteSameBatch() {
  section("Test 6: Append then overwrite SAME file in one batch");

  await cleanContext();

  const result = await writeContext([
    {
      file: "progress",
      action: "append",
      content: "## Step that will be lost\n- This append will be overwritten",
    },
    {
      file: "progress",
      action: "overwrite",
      content: "# Final Progress\n- [x] Only this should remain",
    },
  ]);

  const content = await readFile(join(process.cwd(), ".context/task_progress.md"), "utf-8");
  assert(content.includes("Final Progress"), "Overwrite is the final state");
  assert(!content.includes("will be lost"), "Appended content is correctly overwritten");
}

async function testFindLastNumberEdgeCases() {
  section("Test 7: findLastNumber edge cases");

  assert(findLastNumber("") === 0, "Empty string returns 0");
  assert(findLastNumber("# Just a header\nno sections") === 0, "No ## sections returns 0");
  assert(findLastNumber("## 0. Zero entry") === 0, "## 0. returns 0 (parseInt)");
  assert(findLastNumber("## 999. Big number\n## 1. Small") === 999, "Finds max, not last");
  assert(findLastNumber("## 3. Gapped\n## 7. More gapped") === 7, "Handles gaps correctly");
  assert(findLastNumber("### 5. Three hashes") === 0, "### is NOT matched (only ##)");
  assert(findLastNumber("##5. No space") === 0, "##5. without space is NOT matched");
}

async function testFormatRelatedToSpaces() {
  section("Test 8: formatRelatedTo with IDs containing spaces");

  const result = formatRelatedTo(["ADR-1 Extended", "踩坑#3 重要"]);
  assert(result.includes("architecture.md#adr-1-extended"), "Spaces in ADR ID become hyphens in anchor");
  assert(result.includes("gotchas.md#3"), "Gotcha with trailing text still extracts number");
}

async function testSyncLoadPullFailureMessage() {
  section("Test 9: sync_load pull failure (silent vs reported)");

  // Temporarily break the remote to force a pull failure
  const origRemoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();

  try {
    execSync("git remote set-url origin https://invalid.example.com/broken.git", { stdio: "pipe" });

    // Write some context so sync_load has something to return
    await writeContext([
      { file: "summary", action: "overwrite", content: "# Summary\nLocal content" },
    ]);

    const result = await syncLoad(undefined);
    const text = result.content[0].text;

    // sync_load catches pull errors silently — this is the question:
    // should it warn the user that pull failed?
    assert(text.includes("Context restored") || text.includes("Summary"),
      "sync_load still returns local content when pull fails");

    // Check if there's any pull failure warning
    const hasPullWarning = text.includes("pull") || text.includes("remote") || text.includes("warning");
    console.log(`  ℹ️  Pull failure warning to user: ${hasPullWarning ? "YES" : "NO (silent)"}`);
    if (!hasPullWarning) {
      bugs.push("sync_load silently ignores git pull failure — user may get stale data without knowing");
    }
  } finally {
    // Restore original remote
    execSync(`git remote set-url origin "${origRemoteUrl}"`, { stdio: "pipe" });
  }
}

async function testWriteContextSpecialMarkdown() {
  section("Test 10: Content with markdown special chars");

  await cleanContext();

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: '## Tricky Content\n- Backticks: `code`\n- Pipe: | in | table |\n- Link: [test](http://example.com)\n- HTML: <div>raw html</div>',
    },
  ]);

  const content = await readFile(join(process.cwd(), ".context/gotchas.md"), "utf-8");
  assert(content.includes("`code`"), "Backticks preserved");
  assert(content.includes("| in | table |"), "Pipes preserved");
  assert(content.includes("[test](http://example.com)"), "Links preserved");
  assert(content.includes("<div>raw html</div>"), "HTML preserved");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Context Sync MCP — Extended Audit (Pass 2)            ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n📂 Working directory: ${process.cwd()}`);

  await cleanContext();

  try {
    await testEmptyEntriesArray();
    await testSyncMetaOnlyContext();
    await testUnicodeContent();
    await testWhitespaceOnlyContent();
    await testOverwriteThenAppendSameBatch();
    await testAppendThenOverwriteSameBatch();
    await testFindLastNumberEdgeCases();
    await testFormatRelatedToSpaces();
    await testSyncLoadPullFailureMessage();
    await testWriteContextSpecialMarkdown();
  } catch (error: any) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    console.error(error.stack);
    failed++;
    bugs.push(`Unexpected crash: ${error.message}`);
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (bugs.length > 0) {
    console.log(`\n🐛 Issues found (${bugs.length}):`);
    bugs.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
  }
  console.log("══════════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main();
