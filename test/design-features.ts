/**
 * Tests for new design features added in the design review round:
 * 1. Auto SUMMARY.md generation on sync_push
 * 2. sync_meta display in sync_load output
 * 3. .gitattributes auto-creation
 * 4. write_context entry count in response
 * 5. sync_push with custom summary parameter
 * 6. git pull --ff-only behavior
 * 7. graceful shutdown signals
 * 8. countSections utility
 */

import { writeContext } from "../dist/tools/write-context.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import {
  generateSummary,
  readSyncMeta,
  ensureGitattributes,
  countSections,
  findLastNumber,
} from "../dist/utils.js";
import { readFile, rm, access } from "node:fs/promises";
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ── Tests ────────────────────────────────────────────────────────────

async function testAutoSummaryGeneration() {
  section("Test 1: sync_push auto-generates SUMMARY.md");

  await cleanContext();

  // Write some context files
  await writeContext([
    { file: "gotchas", action: "append", content: "## Bug found\n- Some bug details" },
    { file: "architecture", action: "append", content: "## ADR: Use Redis\n- Faster caching" },
    { file: "progress", action: "overwrite", content: "# Progress\n- [x] Step 1\n- [ ] Step 2" },
  ]);

  // Push — should auto-generate SUMMARY.md
  await syncPush();

  const summaryPath = join(process.cwd(), ".context/SUMMARY.md");
  const exists = await fileExists(summaryPath);
  assert(exists, "SUMMARY.md auto-generated");

  if (exists) {
    const content = await readFile(summaryPath, "utf-8");
    assert(content.includes("项目上下文索引"), "SUMMARY has header");
    assert(content.includes("最后同步"), "SUMMARY has sync timestamp");
    assert(content.includes("设备"), "SUMMARY has device info");
    assert(content.includes("task_progress.md"), "SUMMARY lists progress file");
    assert(content.includes("gotchas.md"), "SUMMARY lists gotchas file");
    assert(content.includes("architecture.md"), "SUMMARY lists architecture file");
  }
}

async function testCustomSummaryParameter() {
  section("Test 2: sync_push with custom summary parameter");

  await cleanContext();

  await writeContext([
    { file: "gotchas", action: "append", content: "## Test gotcha\n- Detail" },
  ]);

  // Push with custom summary
  await syncPush("# Custom Summary\nThis is a custom project overview.");

  const content = await readFile(join(process.cwd(), ".context/SUMMARY.md"), "utf-8");
  assert(content.includes("Custom Summary"), "Custom summary written");
  assert(!content.includes("项目上下文索引"), "Auto-generated summary NOT used");
}

async function testSyncMetaDisplay() {
  section("Test 3: sync_load shows sync_meta info");

  // After the previous push, sync_meta.json should exist
  const result = await syncLoad(undefined);
  const text = result.content[0].text;

  assert(text.includes("Last sync:"), "Shows last sync time");
  assert(text.includes("Device:"), "Shows device name");
  assert(text.includes("Agent:"), "Shows agent type");
}

async function testSyncMetaDisplayTopic() {
  section("Test 4: sync_load (topic) also shows sync_meta info");

  const result = await syncLoad("gotchas");
  const text = result.content[0].text;

  assert(text.includes("Last sync:") || text.includes("📌"), "Topic load shows sync meta");
}

async function testGitattributesAutoCreation() {
  section("Test 5: .gitattributes auto-created on sync_push");

  const gaPath = join(process.cwd(), ".context/.gitattributes");
  const exists = await fileExists(gaPath);
  assert(exists, ".gitattributes file exists");

  if (exists) {
    const content = await readFile(gaPath, "utf-8");
    assert(content.includes("text eol=lf"), "Has text normalization rules");
    assert(content.includes("*.md"), "Covers .md files");
    assert(content.includes("sync_meta.json"), "Covers sync_meta.json");
  }
}

async function testGitattributesNotOverwritten() {
  section("Test 6: .gitattributes NOT overwritten if already exists");

  // Manually write a custom .gitattributes
  const gaPath = join(process.cwd(), ".context/.gitattributes");
  const { writeFile: wf } = await import("node:fs/promises");
  await wf(gaPath, "# Custom gitattributes\n*.md -diff\n", "utf-8");

  // Trigger ensureGitattributes
  const { getProjectRoot } = await import("../dist/utils.js");
  const root = await getProjectRoot();
  await ensureGitattributes(root);

  const content = await readFile(gaPath, "utf-8");
  assert(content.includes("Custom gitattributes"), "Existing .gitattributes preserved");
  assert(!content.includes("text eol=lf"), "Default content NOT forced");
}

async function testWriteContextEntryCount() {
  section("Test 7: write_context returns entry count");

  await cleanContext();

  // Append to gotchas — should show entry count
  const r1 = await writeContext([
    { file: "gotchas", action: "append", content: "## First Bug\n- Detail" },
  ]);
  assert(r1.content[0].text.includes("1 entries") || r1.content[0].text.includes("now 1"),
    "First append shows 1 entry",
    r1.content[0].text.split("\n")[0]
  );

  const r2 = await writeContext([
    { file: "gotchas", action: "append", content: "## Second Bug\n- Detail" },
  ]);
  assert(r2.content[0].text.includes("2 entries") || r2.content[0].text.includes("now 2"),
    "Second append shows 2 entries",
    r2.content[0].text.split("\n")[0]
  );

  // Overwrite progress — should show line count
  const r3 = await writeContext([
    { file: "progress", action: "overwrite", content: "# Progress\n- [x] A\n- [ ] B\n- [ ] C" },
  ]);
  assert(r3.content[0].text.includes("lines"),
    "Overwrite shows line count",
    r3.content[0].text.split("\n")[0]
  );
}

async function testCountSectionsUtility() {
  section("Test 8: countSections utility");

  assert(countSections("") === 0, "Empty string: 0");
  assert(countSections("# No sections") === 0, "No ## sections: 0");
  assert(countSections("## 1. One\n## 2. Two") === 2, "Two sections: 2");
  assert(countSections("## 1. One\n```\n## 99. Fake\n```\n## 2. Two") === 2,
    "Code block sections excluded: 2");
}

async function testGenerateSummaryUtility() {
  section("Test 9: generateSummary utility");

  await cleanContext();

  await writeContext([
    { file: "gotchas", action: "append", content: "## Bug\n- Detail" },
    { file: "progress", action: "overwrite", content: "# Tasks\n- [x] Done" },
  ]);

  const { getProjectRoot } = await import("../dist/utils.js");
  const root = await getProjectRoot();
  const summary = await generateSummary(root);

  assert(summary.includes("项目上下文索引"), "Has header");
  assert(summary.includes("详细主题"), "Has topics section");
  assert(summary.includes("gotchas.md"), "Lists gotchas");
  assert(summary.includes("task_progress.md"), "Lists progress");
  assert(!summary.includes("api_notes.md"), "Does NOT list empty api_notes");
}

async function testReadSyncMeta() {
  section("Test 10: readSyncMeta utility");

  await cleanContext();

  const { getProjectRoot } = await import("../dist/utils.js");
  const root = await getProjectRoot();

  // Before any push, no sync_meta
  let meta = await readSyncMeta(root);
  assert(meta === null, "No sync_meta before push");

  // Write and push
  await writeContext([
    { file: "gotchas", action: "append", content: "## Test\n- Detail" },
  ]);
  await syncPush();

  meta = await readSyncMeta(root);
  assert(meta !== null, "sync_meta exists after push");
  if (meta) {
    assert(typeof meta.last_sync === "string", "Has last_sync string");
    assert(typeof meta.device === "string" && meta.device !== "unknown", "Has real device name");
    assert(typeof meta.agent === "string", "Has agent field");
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Context Sync MCP — New Design Features Tests          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n📂 Working directory: ${process.cwd()}`);

  await cleanContext();

  try {
    await testAutoSummaryGeneration();
    await testCustomSummaryParameter();
    await testSyncMetaDisplay();
    await testSyncMetaDisplayTopic();
    await testGitattributesAutoCreation();
    await testGitattributesNotOverwritten();
    await testWriteContextEntryCount();
    await testCountSectionsUtility();
    await testGenerateSummaryUtility();
    await testReadSyncMeta();
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
