/**
 * 10-Round Debug Session — Full lifecycle cross-device simulation
 *
 * Simulates real-world usage across 2 devices with 10 progressive rounds,
 * each testing a distinct scenario that would happen in actual agent usage.
 *
 * Setup: uses 2 separate git clones (device-a, device-b) sharing a bare remote.
 */

import { writeContext } from "../dist/tools/write-context.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import {
  getProjectRoot,
  readSyncMeta,
  ensureContextDir,
  CONTEXT_DIR,
  FILE_MAP,
} from "../dist/utils.js";
import { readFile, writeFile, rm, mkdir, access } from "node:fs/promises";
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
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  🔄 ${title}`);
  console.log(`${"═".repeat(60)}`);
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

// Two-device simulation setup
const BASE = "/tmp/context-sync-debug-10r";
const REMOTE = `${BASE}/remote.git`;
const DEV_A = `${BASE}/device-a`;
const DEV_B = `${BASE}/device-b`;

function setupTwoDevices() {
  execSync(`rm -rf ${BASE}`, { stdio: "pipe" });
  execSync(`mkdir -p ${BASE}`, { stdio: "pipe" });
  // Create bare remote
  execSync(`git init --bare ${REMOTE}`, { stdio: "pipe" });
  // Clone device A
  execSync(`git clone ${REMOTE} ${DEV_A}`, { stdio: "pipe" });
  execSync(`cd ${DEV_A} && git commit --allow-empty -m "init" && git push`, { stdio: "pipe" });
  // Clone device B
  execSync(`git clone ${REMOTE} ${DEV_B}`, { stdio: "pipe" });
}

function switchDevice(dir: string) {
  process.chdir(dir);
}

function pull(dir: string) {
  try { execSync(`cd ${dir} && git pull --ff-only`, { stdio: "pipe" }); } catch { /* ignore */ }
}

// ── ROUNDS ──────────────────────────────────────────────────────────

async function round1() {
  section("Round 1: Device A — 发现踩坑 + 做架构决策 + 记录进度");
  switchDevice(DEV_A);

  const r = await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: "## SQLite WAL 跨进程问题\n- **现象**：多进程写入报 SQLITE_BUSY\n- **原因**：WAL 模式不支持跨进程写入\n- **解决**：使用 journal_mode=DELETE\n- **影响文件**：src/db/connection.ts",
    },
    {
      file: "architecture",
      action: "append",
      content: "## 数据库选择 SQLite\n- **决策**：使用 SQLite 而非 PostgreSQL\n- **原因**：单机应用，部署简单\n- **影响**：不支持并发写入",
      related_to: ["踩坑#1"],
    },
    {
      file: "progress",
      action: "overwrite",
      content: "# 任务进度\n\n## 认证模块重构（JWT → Session）\n\n- [x] 创建 Session store\n- [x] 修改 auth middleware\n- [ ] 实现 logout 接口 ← 当前\n- [ ] session 过期刷新\n- [ ] 单元测试",
    },
  ]);

  assert(r.content[0].text.includes("Appended to gotchas"), "gotchas written");
  assert(r.content[0].text.includes("Appended to architecture"), "architecture written");
  assert(r.content[0].text.includes("Overwrote progress"), "progress written");
  assert(r.content[0].text.includes("entries") || r.content[0].text.includes("lines"), "Entry counts shown");
}

async function round2() {
  section("Round 2: Device A — sync_push 推送到远程");
  switchDevice(DEV_A);

  const r = await syncPush();
  const text = r.content[0].text;

  assert(text.includes("✅"), "Push succeeds");
  assert(text.includes("Device:"), "Shows device info");

  // Verify SUMMARY.md was auto-generated
  const summary = await readFile(join(DEV_A, ".context/SUMMARY.md"), "utf-8");
  assert(summary.includes("项目上下文索引"), "SUMMARY auto-generated");
  assert(summary.includes("gotchas.md"), "SUMMARY lists gotchas");

  // Verify .gitattributes created
  const ga = await readFile(join(DEV_A, ".context/.gitattributes"), "utf-8");
  assert(ga.includes("merge=ours"), ".gitattributes created");

  // Verify sync_meta.json
  const meta = await readSyncMeta(DEV_A);
  assert(meta !== null && typeof meta.last_sync === "string", "sync_meta has timestamp");
}

async function round3() {
  section("Round 3: Device B — sync_load 恢复上下文");
  switchDevice(DEV_B);

  const r = await syncLoad(undefined);
  const text = r.content[0].text;

  assert(text.includes("Context restored"), "Context restored on Device B");
  assert(text.includes("Last sync:"), "Shows sync_meta info");
  assert(text.includes("SQLite WAL"), "Gotcha content from Device A");
  assert(text.includes("认证模块重构"), "Progress content from Device A");
  assert(text.includes("数据库选择"), "Architecture from Device A");
}

async function round4() {
  section("Round 4: Device B — 追加新踩坑 + 更新进度 + push 回去");
  switchDevice(DEV_B);

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: "## Next.js Middleware 限制\n- **现象**：middleware 中用 Node.js API 报错\n- **原因**：运行在 Edge Runtime\n- **解决**：验证逻辑移到 API Route",
      related_to: ["ADR-2"],
    },
    {
      file: "progress",
      action: "overwrite",
      content: "# 任务进度\n\n## 认证模块重构（JWT → Session）\n\n- [x] 创建 Session store\n- [x] 修改 auth middleware\n- [x] 实现 logout 接口 ✅\n- [ ] session 过期刷新 ← 当前\n- [ ] 单元测试",
    },
    {
      file: "api_notes",
      action: "append",
      content: "## /api/auth/refresh\n- 有 rate limit，1分钟最多5次\n- 返回新 accessToken，旧 token 立即失效",
    },
  ]);

  // Verify numbering continues from Device A's entries
  const gotchas = await readFile(join(DEV_B, ".context/gotchas.md"), "utf-8");
  assert(gotchas.includes("## 1. SQLite WAL"), "Device A's #1 preserved");
  assert(gotchas.includes("## 2. Next.js Middleware"), "Device B's entry numbered as #2");
  assert(gotchas.includes("[ADR-2](architecture.md#adr-2)"), "related_to link generated");

  const pushR = await syncPush();
  assert(pushR.content[0].text.includes("✅"), "Device B push succeeds");
}

async function round5() {
  section("Round 5: Device A — sync_load 看到 B 的改动");
  switchDevice(DEV_A);

  const r = await syncLoad(undefined);
  const text = r.content[0].text;

  assert(text.includes("Next.js Middleware"), "Device A sees B's gotcha");
  assert(text.includes("logout 接口 ✅"), "Device A sees B's progress update");
  assert(text.includes("/api/auth/refresh"), "Device A sees B's api_notes");
}

async function round6() {
  section("Round 6: topic 定向 load + 自定义 summary push");
  switchDevice(DEV_A);

  // Topic load
  const gotchaR = await syncLoad("gotchas");
  assert(gotchaR.content[0].text.includes("SQLite WAL"), "Topic load: gotchas has #1");
  assert(gotchaR.content[0].text.includes("Next.js Middleware"), "Topic load: gotchas has #2");
  assert(!gotchaR.content[0].text.includes("认证模块重构"), "Topic load: no progress mixed in");

  // Custom summary push
  await writeContext([
    {
      file: "architecture",
      action: "append",
      content: "## Session 替代 JWT\n- **决策**：从 JWT 迁移到 Session\n- **原因**：需要服务端踢人功能",
      related_to: ["ADR-1", "踩坑#2"],
    },
  ]);

  const pushR = await syncPush("# 项目概要\n\nNext.js 14 认证重构项目。\n已完成 logout，正在做 session 刷新。\n\n## 关键风险\n- SQLite 并发限制\n- Edge Runtime 兼容性");
  assert(pushR.content[0].text.includes("✅"), "Custom summary push succeeds");

  const summary = await readFile(join(DEV_A, ".context/SUMMARY.md"), "utf-8");
  assert(summary.includes("项目概要"), "Custom summary used, not auto-generated");
  assert(summary.includes("关键风险"), "Custom summary content preserved");
}

async function round7() {
  section("Round 7: 连续 push 无变更 + 错误恢复");
  switchDevice(DEV_A);

  // Double push — second should detect no changes
  const r1 = await syncPush();
  assert(r1.content[0].text.includes("No changes") || r1.content[0].text.includes("ℹ️"),
    "No-change push detected");

  // Break remote temporarily
  const origUrl = execSync(`cd ${DEV_A} && git remote get-url origin`, { encoding: "utf-8" }).trim();
  execSync(`cd ${DEV_A} && git remote set-url origin /nonexistent/repo.git`, { stdio: "pipe" });

  await writeContext([
    { file: "gotchas", action: "append", content: "## 临时错误测试\n- test" },
  ]);
  const pushFail = await syncPush();
  assert(
    pushFail.content[0].text.includes("could not be pushed") ||
    pushFail.content[0].text.includes("push failed") ||
    pushFail.content[0].text.includes("Remote network check failed") ||
    pushFail.content[0].text.includes("No valid remote push target"),
    "Reports push failure gracefully");
  assert(!pushFail.content[0].text.includes("❌ Sync push failed"), "Not a fatal error, just push failed");

  // Restore remote
  execSync(`cd ${DEV_A} && git remote set-url origin "${origUrl}"`, { stdio: "pipe" });
  // Manual push to fix state
  execSync(`cd ${DEV_A} && git push`, { stdio: "pipe" });
}

async function round8() {
  section("Round 8: 大批量 + 特殊字符 + 编号连续性");
  switchDevice(DEV_B);
  pull(DEV_B);

  // Append 5 more gotchas in one batch
  const batchEntries = [];
  for (let i = 0; i < 5; i++) {
    batchEntries.push({
      file: "gotchas" as const,
      action: "append" as const,
      content: `## 批量踩坑 ${i+1}\n- 😱 Emoji: 🔥💀🎯\n- 特殊符号: <div>&amp;</div>\n- 代码: \`const x = "hello"\`\n- 中文：第${i+1}个批量测试`,
    });
  }
  await writeContext(batchEntries);

  const content = await readFile(join(DEV_B, ".context/gotchas.md"), "utf-8");

  // Previous entries: #1 (SQLite), #2 (Next.js), #3 (临时错误)
  // New batch should be #4, #5, #6, #7, #8
  assert(content.includes("## 4."), "Batch entry #4 numbered correctly");
  assert(content.includes("## 8."), "Batch entry #8 numbered correctly");
  assert(content.includes("🔥💀🎯"), "Emoji preserved in batch");
  assert(content.includes("<div>&amp;</div>"), "HTML entities preserved");

  // Count total sections
  const sectionMatches = [...content.matchAll(/^## \d+\./gm)];
  assert(sectionMatches.length === 8, `Total 8 sections (got ${sectionMatches.length})`);

  await syncPush();
}

async function round9() {
  section("Round 9: 覆写→追加→覆写 混合 + api_notes 追加");
  switchDevice(DEV_A);
  pull(DEV_A);

  // Complex mixed operations
  await writeContext([
    // Overwrite progress (fresh state)
    {
      file: "progress",
      action: "overwrite",
      content: "# Phase 2 任务\n- [ ] 添加 Redis 缓存\n- [ ] WebSocket 实时通知",
    },
    // Append api_notes
    {
      file: "api_notes",
      action: "append",
      content: "## /api/ws\n- 使用 Socket.IO\n- 需要 CORS 配置",
    },
    // Overwrite progress AGAIN (simulating agent correcting itself)
    {
      file: "progress",
      action: "overwrite",
      content: "# Phase 2 任务（修正版）\n- [ ] 添加 Redis 缓存\n- [ ] WebSocket 实时通知\n- [ ] 数据库迁移脚本",
    },
    // Append another api_note
    {
      file: "api_notes",
      action: "append",
      content: "## /api/cache\n- Redis TTL 默认 5 分钟\n- 支持手动清除",
    },
  ]);

  const progress = await readFile(join(DEV_A, ".context/task_progress.md"), "utf-8");
  assert(progress.includes("修正版"), "Second overwrite wins");
  assert(progress.includes("数据库迁移脚本"), "Last overwrite content preserved");
  assert(!progress.includes("Phase 2 任务\n"), "First overwrite content replaced");

  const apiNotes = await readFile(join(DEV_A, ".context/api_notes.md"), "utf-8");
  assert(apiNotes.includes("/api/auth/refresh"), "Previous api_note preserved");
  assert(apiNotes.includes("/api/ws"), "New api_note #1 appended");
  assert(apiNotes.includes("/api/cache"), "New api_note #2 appended");

  await syncPush();
}

async function round10() {
  section("Round 10: 最终验证 — Device B 完整恢复 + 数据完整性");
  switchDevice(DEV_B);

  const r = await syncLoad(undefined);
  const text = r.content[0].text;

  assert(text.includes("Context restored"), "Final load succeeds");
  assert(text.includes("Last sync:"), "Shows sync_meta");

  // Verify all content from all rounds survived
  assert(text.includes("SQLite WAL"), "R1 gotcha #1 survived");
  assert(text.includes("Next.js Middleware"), "R4 gotcha #2 survived");
  assert(text.includes("Session 替代 JWT"), "R6 architecture survived");
  assert(text.includes("修正版"), "R9 final progress survived");
  assert(text.includes("/api/auth/refresh"), "R4 api_note survived");
  assert(text.includes("/api/ws"), "R9 api_note #1 survived");
  assert(text.includes("/api/cache"), "R9 api_note #2 survived");
  assert(text.includes("批量踩坑"), "R8 batch gotchas survived");

  // Verify SUMMARY.md has correct index
  const summary = await readFile(join(DEV_B, ".context/SUMMARY.md"), "utf-8");
  assert(summary.includes("gotchas.md"), "SUMMARY lists gotchas");
  assert(summary.includes("task_progress.md"), "SUMMARY lists progress");
  assert(summary.includes("architecture.md"), "SUMMARY lists architecture");
  assert(summary.includes("api_notes.md"), "SUMMARY lists api_notes");

  // Verify .gitattributes synced
  const gaPath = join(DEV_B, ".context/.gitattributes");
  const gaExists = await fileExists(gaPath);
  assert(gaExists, ".gitattributes synced to Device B");

  // Verify gotchas numbering integrity
  const gotchas = await readFile(join(DEV_B, ".context/gotchas.md"), "utf-8");
  const nums = [...gotchas.matchAll(/^## (\d+)\./gm)].map(m => parseInt(m[1]));
  const isSequential = nums.every((n, i) => i === 0 || n > nums[i-1]);
  assert(isSequential, `Gotcha numbers are strictly increasing: [${nums.join(",")}]`);
  assert(nums.length >= 8, `At least 8 gotchas total (got ${nums.length})`);

  // Verify sync_meta roundtrip
  const meta = await readSyncMeta(DEV_B);
  assert(meta !== null, "sync_meta available on Device B");
  if (meta) {
    assert(new Date(meta.last_sync).getFullYear() === 2026, "sync_meta timestamp is recent");
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   Context Sync MCP — 10-Round Cross-Device Debug Session    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const originalCwd = process.cwd();

  try {
    console.log("\n⚙️  Setting up 2-device simulation (bare remote + 2 clones)...");
    setupTwoDevices();
    console.log("  ✅ Setup complete");

    await round1();
    await round2();
    await round3();
    await round4();
    await round5();
    await round6();
    await round7();
    await round8();
    await round9();
    await round10();

  } catch (error: any) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    console.error(error.stack);
    failed++;
    bugs.push(`Unexpected crash: ${error.message}`);
  } finally {
    process.chdir(originalCwd);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (bugs.length > 0) {
    console.log(`\n🐛 Bugs found (${bugs.length}):`);
    bugs.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
  } else {
    console.log("\n🎉 All 10 rounds passed! No bugs found.");
  }
  console.log(`${"═".repeat(60)}`);

  // Cleanup
  try { execSync(`rm -rf ${BASE}`, { stdio: "pipe" }); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

main();
