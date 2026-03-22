/**
 * Cross-device acceptance test
 *
 * Focus:
 * 1. Distinguish "progress marker only" from actual detailed context files
 * 2. Verify a real structured note survives save/load across two devices
 * 3. Verify topic-only load can recover the detailed note precisely
 */

import { syncInit } from "../dist/tools/sync-init.js";
import { writeContext } from "../dist/tools/write-context.js";
import { syncPush } from "../dist/tools/sync-push.js";
import { syncLoad } from "../dist/tools/sync-load.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    const message = `${label}${detail ? " — " + detail : ""}`;
    console.log(`  ❌ ${message}`);
    failed++;
    failures.push(message);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

const BASE = "/tmp/context-sync-cross-device-acceptance";
const REMOTE = `${BASE}/remote.git`;
const DEV_A = `${BASE}/device-a`;
const DEV_B = `${BASE}/device-b`;

function setupTwoDevices() {
  execSync(`rm -rf ${BASE}`, { stdio: "pipe" });
  execSync(`mkdir -p ${BASE}`, { stdio: "pipe" });
  execSync(`git init --bare ${REMOTE}`, { stdio: "pipe" });
  execSync(`git clone ${REMOTE} ${DEV_A}`, { stdio: "pipe" });
  execSync(`cd ${DEV_A} && git commit --allow-empty -m "init" && git push`, { stdio: "pipe" });
  execSync(`git clone ${REMOTE} ${DEV_B}`, { stdio: "pipe" });
}

function switchDevice(dir: string) {
  process.chdir(dir);
}

async function testProgressOnlyRoundTrip() {
  section("A1: 仅保存 progress 时不会伪造详细记录");

  switchDevice(DEV_A);
  await writeFile(join(DEV_A, "README.md"), "# Context Sync Acceptance\n", "utf-8");

  const initResult = await syncInit(undefined, undefined, DEV_A, true);
  const initText = initResult.content[0].text;
  assert(initText.includes("initialized"), "Device A 初始化成功");

  await writeContext([
    {
      file: "progress",
      action: "overwrite",
      content: [
        "# 任务进度",
        "",
        "## 当前项目：跨设备同步验收",
        "- [x] 完成首次 /sync-save 与 /sync-load 验证",
        "- [ ] 记录一条测试详情到 gotchas 并再次同步",
        "- [ ] 另一台机器补充的同步测试记录待保存",
      ].join("\n"),
    },
  ], DEV_A);

  const pushResult = await syncPush(undefined, DEV_A);
  assert(pushResult.content[0].text.includes("✅"), "progress-only 变更已推送");

  switchDevice(DEV_B);
  const loadResult = await syncLoad(undefined, DEV_B);
  const loadText = loadResult.content[0].text;

  assert(loadText.includes("Context restored"), "Device B 可恢复上下文");
  assert(loadText.includes("(2 files loaded)"), "仅加载 summary + progress 两个文件");
  assert(loadText.includes("task_progress.md"), "返回 progress 文件");
  assert(!loadText.includes("gotchas.md"), "未保存 gotchas 时不伪造 gotchas 文件");
  assert(
    !loadText.includes("这是另一台机器补充的同步测试记录正文"),
    "未保存详细正文时不会凭空出现正文"
  );
}

async function testStructuredDetailRoundTrip() {
  section("A2: 保存结构化详细记录后可跨设备恢复正文");

  switchDevice(DEV_B);

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: [
        "## 跨设备同步测试记录",
        "- **现象**：另一台机器执行 /sync-load 后，只看到进度提示，想确认是否有真实正文同步过来",
        "- **原因**：之前只更新了 progress，没有把测试详情写入结构化上下文文件",
        "- **解决**：把具体测试记录写入 gotchas，再执行 /sync-save",
        "- **验证**：这是另一台机器补充的同步测试记录正文",
        "- **影响文件**：.context/gotchas.md, .context/task_progress.md",
      ].join("\n"),
    },
    {
      file: "progress",
      action: "overwrite",
      content: [
        "# 任务进度",
        "",
        "## 当前项目：跨设备同步验收",
        "- [x] 完成首次 /sync-save 与 /sync-load 验证",
        "- [x] 记录一条测试详情到 gotchas 并再次同步",
        "- [x] 另一台机器补充了同步测试记录并已保存",
      ].join("\n"),
    },
  ], DEV_B);

  const pushResult = await syncPush(undefined, DEV_B);
  assert(pushResult.content[0].text.includes("✅"), "Device B 结构化记录已推送");

  switchDevice(DEV_A);
  const loadResult = await syncLoad(undefined, DEV_A);
  const loadText = loadResult.content[0].text;

  assert(loadText.includes("(3 files loaded)"), "Device A 现在会加载 summary + progress + gotchas");
  assert(loadText.includes("gotchas.md"), "返回 gotchas 文件");
  assert(loadText.includes("## 1. 跨设备同步测试记录"), "gotchas 记录带编号恢复");
  assert(loadText.includes("这是另一台机器补充的同步测试记录正文"), "真实正文已跨设备恢复");
  assert(loadText.includes("另一台机器补充了同步测试记录并已保存"), "progress 更新也同步回来");

  const gotchasTopic = await syncLoad("gotchas", DEV_A);
  const gotchasText = gotchasTopic.content[0].text;
  assert(gotchasText.includes("跨设备同步测试记录"), "topic load 可定向恢复 gotchas");
  assert(gotchasText.includes("这是另一台机器补充的同步测试记录正文"), "topic load 保留详细正文");
  assert(!gotchasText.includes("当前项目：跨设备同步验收"), "topic load 不混入 progress 内容");

  const gotchasFile = await readFile(join(DEV_A, ".context/gotchas.md"), "utf-8");
  assert(gotchasFile.includes("## 1. 跨设备同步测试记录"), "本地 gotchas 文件也落盘正确");
}

async function testRemoteAheadBlocksBeforeCommit() {
  section("A3: 远端领先时 sync_push 在 commit 前拦截");

  switchDevice(DEV_B);
  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: [
        "## 远端领先测试",
        "- **现象**：另一台设备尚未拉取最新 `.context/`，却尝试再次 `/sync-save`",
        "- **预期**：在生成新的 sync commit 前就提示先 `/sync-load`",
      ].join("\n"),
    },
  ], DEV_B);
  const remotePush = await syncPush(undefined, DEV_B);
  assert(remotePush.content[0].text.includes("✅"), "Device B 先推送一条新上下文");

  switchDevice(DEV_A);
  const beforeCount = parseInt(
    execSync(`cd ${DEV_A} && git rev-list --count HEAD`, { encoding: "utf-8" }).trim(),
    10
  );

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: [
        "## 本地待保存测试",
        "- **现象**：本地也新增了一条上下文，但还没先 load 远端更新",
        "- **预期**：sync_push 应提示远端领先，而不是先 commit 再失败",
      ].join("\n"),
    },
  ], DEV_A);

  const blockedPush = await syncPush(undefined, DEV_A);
  const blockedText = blockedPush.content[0].text;
  const afterCount = parseInt(
    execSync(`cd ${DEV_A} && git rev-list --count HEAD`, { encoding: "utf-8" }).trim(),
    10
  );

  assert(blockedText.includes("Remote context is ahead"), "远端领先时给出专门提示");
  assert(blockedText.includes("/sync-load"), "提示用户先执行 /sync-load");
  assert(beforeCount === afterCount, "被拦截时不会先创建新的本地 sync commit");
}

async function testFetchFailureBlocksBeforeCommit() {
  section("A4: fetch 失败时 sync_push 在 commit 前中止");

  switchDevice(DEV_A);
  const beforeCount = parseInt(
    execSync(`cd ${DEV_A} && git rev-list --count HEAD`, { encoding: "utf-8" }).trim(),
    10
  );
  const originalUrl = execSync(`cd ${DEV_A} && git remote get-url origin`, { encoding: "utf-8" }).trim();

  await writeContext([
    {
      file: "gotchas",
      action: "append",
      content: [
        "## fetch 失败预检测试",
        "- **现象**：远端状态无法确认时仍继续创建本地 sync commit",
        "- **预期**：先提示修复 fetch，再允许 `/sync-save`",
      ].join("\n"),
    },
  ], DEV_A);

  execSync(`cd ${DEV_A} && git remote set-url origin /nonexistent/context-sync-test.git`, { stdio: "pipe" });

  try {
    const blockedPush = await syncPush(undefined, DEV_A);
    const blockedText = blockedPush.content[0].text;
    const afterCount = parseInt(
      execSync(`cd ${DEV_A} && git rev-list --count HEAD`, { encoding: "utf-8" }).trim(),
      10
    );

    assert(blockedText.includes("Could not verify remote context state before saving"), "fetch 失败时给出预检拦截提示");
    assert(blockedText.includes("save is blocked"), "说明为什么这次不会继续保存");
    assert(afterCount === beforeCount, "fetch 失败时不会先创建新的本地 sync commit");
  } finally {
    execSync(`cd ${DEV_A} && git remote set-url origin "${originalUrl}"`, { stdio: "pipe" });
  }
}

async function main() {
  console.log("🔍 Cross-device acceptance test starting...");
  setupTwoDevices();

  await testProgressOnlyRoundTrip();
  await testStructuredDetailRoundTrip();
  await testRemoteAheadBlocksBeforeCommit();
  await testFetchFailureBlocksBeforeCommit();

  console.log("\n" + "=".repeat(68));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
  }
  console.log("=".repeat(68));

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
