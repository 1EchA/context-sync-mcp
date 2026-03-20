/**
 * Quality Test — Simulates a real agent development session
 *
 * Evaluates from user/agent perspective:
 * - Response message clarity and actionability
 * - Auto-numbering naturalness
 * - SUMMARY auto-gen quality
 * - File format consistency
 * - Edge interactions (empty ops, duplicates, etc.)
 * - Performance with real-world content volume
 */

import { writeContext } from "../dist/tools/write-context.js";
import { syncInit } from "../dist/tools/sync-init.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;
const qualityIssues: string[] = [];

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    const msg = `${label}${detail ? " — " + detail : ""}`;
    console.log(`  ❌ ${msg}`);
    failed++;
    qualityIssues.push(msg);
  }
}

function quality(isGood: boolean, label: string, detail?: string) {
  if (isGood) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    const msg = `[QUALITY] ${label}${detail ? " — " + detail : ""}`;
    console.log(`  ⚠️  ${msg}`);
    qualityIssues.push(msg);
    // Don't count quality issues as hard failures
    passed++;
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

const BASE = "/tmp/context-sync-quality-test";
const REMOTE = `${BASE}/remote.git`;
const WORKDIR = `${BASE}/project`;

function setup() {
  execSync(`rm -rf ${BASE}`, { stdio: "pipe" });
  execSync(`mkdir -p ${BASE}`, { stdio: "pipe" });
  execSync(`git init --bare ${REMOTE}`, { stdio: "pipe" });
  execSync(`git clone ${REMOTE} ${WORKDIR}`, { stdio: "pipe" });
  execSync(`cd ${WORKDIR} && git commit --allow-empty -m "init" && git push`, { stdio: "pipe" });
  process.chdir(WORKDIR);
}

// ── Quality Test Scenarios ─────────────────────────────────────────

async function q0_initBootstrap() {
  section("Q0: sync_init 首次初始化");

  await writeFile(join(WORKDIR, "README.md"), "# Test Sandbox\n\nBootstrap repo for sync_init.\n", "utf-8");

  const result = await syncInit(undefined, undefined, undefined, true);
  const text = result.content[0].text;

  quality(text.includes("initialized"), "sync_init 返回初始化成功提示");
  quality(text.includes("Context synced successfully") || text.includes("Committed locally"), "sync_init 自动执行首次推送");

  const progress = await readFile(join(WORKDIR, ".context/task_progress.md"), "utf-8");
  const summary = await readFile(join(WORKDIR, ".context/SUMMARY.md"), "utf-8");
  const gitFiles = execSync(`cd ${WORKDIR} && git ls-files .context/`, { encoding: "utf-8" });

  quality(progress.includes("已初始化 Context Sync"), "初始化生成默认 progress");
  quality(progress.includes("**当前分支**：master") || progress.includes("**当前分支**：main"), "初始化 progress 带当前分支");
  quality(summary.includes("项目初始化摘要"), "初始化生成默认 summary");
  quality(summary.includes("README 标题") && summary.includes("Test Sandbox"), "初始化 summary 带 README 标题");
  quality(gitFiles.includes("task_progress.md"), "初始化文件已进入 git");
  quality(gitFiles.includes("SUMMARY.md"), "初始化 summary 已进入 git");
}

async function q1_responseMessageQuality() {
  section("Q1: 工具响应消息质量");

  // write_context response
  const r1 = await writeContext([
    { file: "gotchas", action: "append", content: "## 发现数据库连接泄漏\n- **现象**：长时间运行后连接池耗尽\n- **原因**：未在 finally 中释放连接\n- **解决**：使用 using 语法自动释放\n- **文件**：src/db.ts" },
  ]);
  const appendMsg = r1.content[0].text;
  quality(appendMsg.includes("now 1 entries"), "Append 响应包含条目数");
  quality(appendMsg.includes("📁"), "Append 响应包含路径提示");
  quality(!appendMsg.includes("undefined"), "Append 响应无 undefined");

  // overwrite response
  const r2 = await writeContext([
    { file: "progress", action: "overwrite", content: "# 进度\n- [x] 数据库连接\n- [ ] API 接口" },
  ]);
  const overwriteMsg = r2.content[0].text;
  quality(overwriteMsg.includes("lines"), "Overwrite 响应包含行数");
  quality(overwriteMsg.includes("Overwrote"), "Overwrite 使用正确动词");

  // sync_push response
  const r3 = await syncPush();
  const pushMsg = r3.content[0].text;
  quality(pushMsg.includes("✅"), "Push 响应有成功标记");
  quality(pushMsg.includes("Device:"), "Push 响应有设备信息");
  quality(pushMsg.includes("⏰"), "Push 响应有时间信息");

  // sync_load response
  const r4 = await syncLoad(undefined);
  const loadMsg = r4.content[0].text;
  quality(loadMsg.includes("Context restored"), "Load 响应有恢复确认");
  quality(loadMsg.includes("files loaded"), "Load 响应有文件数");
  quality(loadMsg.includes("Last sync:"), "Load 响应有同步元信息");
}

async function q2_autoNumberingNaturalness() {
  section("Q2: 自动编号自然度");

  // Simulate agent discovering bugs one by one
  const topics = [
    { title: "TypeScript 严格模式下联合类型", detail: "需要类型守卫才能窄化" },
    { title: "ESM import 不能省略 .js", detail: "Node.js ESM 要求完整扩展名" },
    { title: "Promise.all 单个失败全部丢弃", detail: "改用 Promise.allSettled" },
  ];

  for (const t of topics) {
    await writeContext([{
      file: "gotchas", action: "append",
      content: `## ${t.title}\n- **现象**：${t.detail}\n- **解决**：见标题`,
    }]);
  }

  const content = await readFile(join(WORKDIR, ".context/gotchas.md"), "utf-8");
  const lines = content.split("\n");

  // Check numbering is natural
  assert(content.includes("## 1. 发现数据库连接泄漏"), "第 1 条保留原始内容和编号");
  assert(content.includes("## 2. TypeScript 严格模式"), "第 2 条编号连续");
  assert(content.includes("## 3. ESM import"), "第 3 条编号连续");
  assert(content.includes("## 4. Promise.all"), "第 4 条编号连续");

  // Check formatting consistency
  const sections = lines.filter(l => /^## \d+\./.test(l));
  const allHavePeriodAndSpace = sections.every(s => /^## \d+\. \S/.test(s));
  quality(allHavePeriodAndSpace, "所有编号格式一致: ## N. Title");
}

async function q3_summaryAutoGenQuality() {
  section("Q3: SUMMARY 自动生成质量");

  // Add more context for richer SUMMARY
  await writeContext([
    { file: "architecture", action: "append", content: "## 选择 Prisma ORM\n- **原因**：类型安全，迁移方便\n- **替代方案**：Drizzle（更轻量但生态少）" },
    { file: "api_notes", action: "append", content: "## POST /api/users\n- 不支持批量创建\n- 返回 201 + Location header" },
  ]);

  await syncPush();
  const summary = await readFile(join(WORKDIR, ".context/SUMMARY.md"), "utf-8");

  quality(summary.includes("项目上下文索引"), "SUMMARY 有标题");
  quality(summary.includes("最后同步"), "SUMMARY 有同步时间");
  quality(summary.includes("设备"), "SUMMARY 有设备信息");
  quality(summary.includes("gotchas.md"), "SUMMARY 索引 gotchas");
  quality(summary.includes("architecture.md"), "SUMMARY 索引 architecture");
  quality(summary.includes("api_notes.md"), "SUMMARY 索引 api_notes");
  quality(summary.includes("task_progress.md"), "SUMMARY 索引 progress");
  quality(summary.includes("lines"), "SUMMARY 显示文件行数");

  // Check readability
  const lineCount = summary.split("\n").length;
  quality(lineCount <= 15, `SUMMARY 简洁（${lineCount} 行 ≤ 15）`);
}

async function q4_fileFormatConsistency() {
  section("Q4: 文件格式一致性");

  const files = ["gotchas.md", "architecture.md", "api_notes.md", "task_progress.md", "SUMMARY.md"];
  for (const f of files) {
    const path = join(WORKDIR, ".context", f);
    try {
      const content = await readFile(path, "utf-8");

      // Check basic formatting
      assert(content.endsWith("\n"), `${f}: 文件以换行符结尾`);
      assert(!content.includes("\r\n"), `${f}: 无 Windows 换行符`);
      assert(!/\n{4,}/.test(content), `${f}: 无过多连续空行`);
      assert(content.startsWith("#"), `${f}: 以标题开头`);
    } catch {
      console.log(`  ⏩ ${f}: 文件不存在，跳过`);
    }
  }
}

async function q5_relatedToLinkQuality() {
  section("Q5: related_to 链接质量");

  await writeContext([
    {
      file: "architecture", action: "append",
      content: "## 迁移到 Redis\n- **决策**：缓存层从内存切换到 Redis\n- **原因**：多实例部署需要共享缓存",
      related_to: ["ADR-1", "踩坑#1", "踩坑#3"],
    },
  ]);

  const content = await readFile(join(WORKDIR, ".context/architecture.md"), "utf-8");
  const linkLine = content.split("\n").find(l => l.includes("关联"));

  assert(linkLine !== undefined, "关联行存在");
  if (linkLine) {
    quality(linkLine.includes("[ADR-1](architecture.md#adr-1)"), "ADR 链接格式正确");
    quality(linkLine.includes("[踩坑#1](gotchas.md#1)"), "踩坑链接格式正确");
    quality(linkLine.includes("[踩坑#3](gotchas.md#3)"), "多个踩坑链接都生成");
    quality(linkLine.includes("，"), "链接间使用中文逗号分隔");
  }
}

async function q6_topicLoadFiltering() {
  section("Q6: topic 定向 load 过滤精度");

  // Load by key name
  const r1 = await syncLoad("gotchas");
  assert(r1.content[0].text.includes("gotchas"), "按 key 名加载");
  assert(!r1.content[0].text.includes("task_progress"), "不包含其他文件内容");

  // Load by filename
  const r2 = await syncLoad("gotchas.md");
  assert(r2.content[0].text.includes("gotchas"), "按文件名加载");

  // Load unknown topic
  const r3 = await syncLoad("nonexistent");
  assert('isError' in r3 && r3.isError === true, "未知 topic 返回错误");
  assert(r3.content[0].text.includes("Available:"), "错误提示可用的 topic 列表");
}

async function q7_performanceWithVolume() {
  section("Q7: 大量内容下的性能");

  const start = Date.now();

  // Write 20 gotchas in rapid succession
  for (let i = 0; i < 20; i++) {
    await writeContext([{
      file: "gotchas", action: "append",
      content: `## 性能测试踩坑 ${i+1}\n- **现象**：第 ${i+1} 个性能测试\n- 行1\n- 行2\n- 行3\n- 行4\n- 行5`,
    }]);
  }

  const writeTime = Date.now() - start;
  quality(writeTime < 5000, `20 次连续 append 在 ${writeTime}ms 内完成（< 5s）`);

  // Check file still correct
  const content = await readFile(join(WORKDIR, ".context/gotchas.md"), "utf-8");
  const sectionCount = [...content.matchAll(/^## \d+\./gm)].length;
  assert(sectionCount === 24, `总共 24 条 gotcha（4 原有 + 20 新增），实际 ${sectionCount}`);

  // Push performance
  const pushStart = Date.now();
  await syncPush();
  const pushTime = Date.now() - pushStart;
  quality(pushTime < 3000, `sync_push 在 ${pushTime}ms 内完成（< 3s）`);

  // Load performance
  const loadStart = Date.now();
  await syncLoad(undefined);
  const loadTime = Date.now() - loadStart;
  quality(loadTime < 2000, `sync_load 在 ${loadTime}ms 内完成（< 2s）`);
}

async function q8_edgeInteractions() {
  section("Q8: 边缘交互");

  // Empty content append
  const r1 = await writeContext([
    { file: "api_notes", action: "append", content: "" },
  ]);
  quality(!r1.content[0].text.includes("Error"), "空内容 append 不报错");

  // Overwrite with same content (idempotent)
  const before = await readFile(join(WORKDIR, ".context/task_progress.md"), "utf-8");
  await writeContext([
    { file: "progress", action: "overwrite", content: before },
  ]);
  const after = await readFile(join(WORKDIR, ".context/task_progress.md"), "utf-8");
  // Content might differ slightly due to trim
  quality(after.trim() === before.trim(), "相同内容覆写是幂等的");

  // Push when nothing changed after a push
  const r2 = await syncPush();
  quality(r2.content[0].text.includes("No changes"), "无变更 push 正确提示");

  // Double load
  const r3 = await syncLoad(undefined);
  const r4 = await syncLoad(undefined);
  assert(r3.content[0].text === r4.content[0].text, "连续两次 load 结果一致");
}

async function q9_errorMessageActionability() {
  section("Q9: 错误消息可操作性");

  // Change to non-git directory
  const tmpDir = "/tmp/context-sync-quality-no-git";
  execSync(`rm -rf ${tmpDir} && mkdir -p ${tmpDir}`, { stdio: "pipe" });
  process.chdir(tmpDir);

  const r1 = await writeContext([
    { file: "gotchas", action: "append", content: "test" },
  ]);
  assert(r1.content[0].text.includes("❌"), "非 git 目录写入有错误标记");
  quality(r1.content[0].text.includes("git"), "错误提示用户需要 git");

  const r2 = await syncPush();
  assert(r2.content[0].text.includes("❌"), "非 git 目录 push 有错误标记");

  const r3 = await syncLoad(undefined);
  quality(r3.content[0].text.includes("clone") || r3.content[0].text.includes("Setup Guide"),
    "非 git 目录 load 有引导信息");

  // Back to workdir
  process.chdir(WORKDIR);
  execSync(`rm -rf ${tmpDir}`, { stdio: "pipe" });
}

async function q10_gitattributesSurvival() {
  section("Q10: .gitattributes 跨 push 存活");

  // Verify gitattributes is tracked in git
  const gitFiles = execSync(`cd ${WORKDIR} && git ls-files .context/`, { encoding: "utf-8" });
  quality(gitFiles.includes(".gitattributes"), ".gitattributes 被 git 追踪");

  // Verify sync_meta.json format
  const meta = await readFile(join(WORKDIR, ".context/sync_meta.json"), "utf-8");
  const parsed = JSON.parse(meta);
  quality(typeof parsed.last_sync === "string", "sync_meta.last_sync 是字符串");
  quality(typeof parsed.device === "string" && parsed.device !== "unknown", "sync_meta.device 有值");
  quality(typeof parsed.agent === "string", "sync_meta.agent 有值");

  // Check JSON is pretty-printed
  quality(meta.includes("\n"), "sync_meta.json 格式化输出（非压缩）");
}

async function q11_promptAliasCoverage() {
  section("Q11: 规则与工具别名覆盖");

  const cursorRules = await readFile(new URL("../.cursorrules", import.meta.url), "utf-8");
  const mdcRules = await readFile(new URL("../rules/context-sync.mdc", import.meta.url), "utf-8");
  const claudeRules = await readFile(new URL("../rules/CLAUDE.md", import.meta.url), "utf-8");
  const indexSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf-8");

  quality(cursorRules.includes("/sync-init"), ".cursorrules 包含 /sync-init 入口");
  quality(cursorRules.includes("sync pull"), ".cursorrules 包含 sync pull → sync_load 映射");
  quality(mdcRules.includes("sync pull"), "Cursor 规则包含 sync pull 别名");
  quality(claudeRules.includes("sync pull"), "Claude 规则包含 sync pull 别名");
  quality(mdcRules.includes("不要说 `/sync-push`") || claudeRules.includes("不对用户说 `/sync-push`"), "规则明确禁止对用户暴露 /sync-push");
  quality(indexSource.includes("Bootstrap Context Sync for a project that has not been initialized yet"), "index 注册了 sync_init 工具描述");
  quality(indexSource.includes("Do NOT use this tool for pull/load/restore/new-device recovery requests"), "sync_push 描述明确排除 load 类请求");
  quality(indexSource.includes("Do NOT use sync_push for these requests"), "sync_load 描述明确接管 sync pull/load 请求");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Context Sync MCP — Quality Test (Real Dev Simulation) ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const originalCwd = process.cwd();

  try {
    console.log("\n⚙️  Setting up test project...");
    setup();
    console.log("  ✅ Setup complete\n");

    await q0_initBootstrap();
    await q1_responseMessageQuality();
    await q2_autoNumberingNaturalness();
    await q3_summaryAutoGenQuality();
    await q4_fileFormatConsistency();
    await q5_relatedToLinkQuality();
    await q6_topicLoadFiltering();
    await q7_performanceWithVolume();
    await q8_edgeInteractions();
    await q9_errorMessageActionability();
    await q10_gitattributesSurvival();
    await q11_promptAliasCoverage();

  } catch (error: any) {
    console.error(`\n💥 Unexpected error: ${error.message}`);
    console.error(error.stack);
    failed++;
    qualityIssues.push(`Crash: ${error.message}`);
  } finally {
    process.chdir(originalCwd);
    try { execSync(`rm -rf ${BASE}`, { stdio: "pipe" }); } catch {}
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (qualityIssues.length > 0) {
    console.log(`\n⚠️  Quality issues (${qualityIssues.length}):`);
    qualityIssues.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
  } else {
    console.log("\n🎉 All quality checks passed!");
  }
  console.log(`${"═".repeat(60)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
