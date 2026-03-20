/**
 * sync_init tool implementation
 *
 * Bootstraps Context Sync for a project that has not been initialized yet.
 * Creates initial progress/summary context, ensures .gitattributes, and can optionally push.
 */

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  resolveBasePath,
  hasGitRepo,
  getProjectRoot,
  hasContextFiles,
  ensureContextDir,
  writeContextFile,
  ensureGitattributes,
  readSyncMeta,
  gitCommand,
} from "../utils.js";
import { syncPush } from "./sync-push.js";

async function getCurrentBranch(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await gitCommand(projectRoot, "rev-parse", "--abbrev-ref", "HEAD");
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}

async function getReadmeTitle(projectRoot: string): Promise<string | null> {
  try {
    const content = await readFile(join(projectRoot, "README.md"), "utf-8");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;

    const firstLine = content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    return firstLine || null;
  } catch {
    return null;
  }
}

function buildInitialProgress(
  projectName: string,
  branchName?: string | null,
  readmeTitle?: string | null,
): string {
  const lines = [
    "# 任务进度",
    "",
    `## 当前项目：${projectName}`,
  ];

  if (branchName) {
    lines.push(`- **当前分支**：${branchName}`);
  }

  if (readmeTitle && readmeTitle !== projectName) {
    lines.push(`- **项目标题**：${readmeTitle}`);
  }

  lines.push(
    "- [x] 已初始化 Context Sync",
    "- [ ] 梳理当前项目目标与范围",
    "- [ ] 记录首批 gotchas / architecture / api_notes",
    "- [ ] 完成首次 /sync-save 与 /sync-load 验证",
  );

  return lines.join("\n") + "\n";
}

function buildInitialSummary(
  projectName: string,
  branchName?: string | null,
  readmeTitle?: string | null,
): string {
  const lines = [
    "# 项目初始化摘要",
    "",
    `- **项目**：${projectName}`,
  ];

  if (branchName) {
    lines.push(`- **当前分支**：${branchName}`);
  }

  if (readmeTitle) {
    lines.push(`- **README 标题**：${readmeTitle}`);
  }

  lines.push(
    "- **状态**：已启用 Context Sync，后续可跨设备同步项目记忆",
    "- **下一步**：在开发过程中持续写入 gotchas、architecture、api_notes 和 progress",
    "- **常用命令**：首次初始化后使用 `/sync-save` 保存增量，使用 `/sync-load` 恢复上下文",
  );

  return lines.join("\n") + "\n";
}

export async function syncInit(
  progress?: string,
  summary?: string,
  projectPath?: string,
  autoPush = true,
) {
  const cwd = resolveBasePath(projectPath);

  if (!(await hasGitRepo(cwd))) {
    return {
      content: [
        {
          type: "text" as const,
          text: "❌ Not in a git repository. Please navigate to a git project before running /sync-init.",
        },
      ],
      isError: true,
    };
  }

  const projectRoot = await getProjectRoot(projectPath);
  const projectName = basename(projectRoot);

  let pullWarning = "";
  try {
    await gitCommand(projectRoot, "pull", "--ff-only");
  } catch (error: any) {
    pullWarning = "\n\n⚠️ git pull failed before init; proceeding with local state.\n" +
      `> ${error.message.split("\n")[0]}`;
  }

  if (await hasContextFiles(projectRoot)) {
    const meta = await readSyncMeta(projectRoot);
    const metaLine = meta
      ? `\n> 📌 Last sync: ${new Date(meta.last_sync).toISOString().replace("T", " ").slice(0, 19)} | 💻 Device: ${meta.device} | 🤖 Agent: ${meta.agent}`
      : "";

    return {
      content: [
        {
          type: "text" as const,
          text: `ℹ️ Context Sync is already initialized for this project.${metaLine}${pullWarning}\n\nUse /sync-load to restore existing context, or /sync-save to push new updates.`,
        },
      ],
    };
  }

  const branchName = await getCurrentBranch(projectRoot);
  const readmeTitle = await getReadmeTitle(projectRoot);
  const contextDir = await ensureContextDir(projectRoot);
  const initialProgress = (
    progress?.trim() ? progress.trim() : buildInitialProgress(projectName, branchName, readmeTitle)
  ) + "\n";
  const initialSummary = (
    summary?.trim() ? summary.trim() : buildInitialSummary(projectName, branchName, readmeTitle)
  ) + "\n";

  await writeContextFile(contextDir, "progress", initialProgress);
  await writeContextFile(contextDir, "summary", initialSummary);
  await ensureGitattributes(projectRoot);

  if (!autoPush) {
    return {
      content: [
        {
          type: "text" as const,
          text: `✅ Context Sync initialized for ${projectName}.\n📁 Created initial context files in ${contextDir}${pullWarning}\n\nNext step: run /sync-save to push this baseline to remote.`,
        },
      ],
    };
  }

  const pushResult = await syncPush(initialSummary, projectPath);
  return {
    content: [
      {
        type: "text" as const,
        text: `✅ Context Sync initialized for ${projectName}.\n📁 Bootstrapped progress + summary in ${contextDir}${pullWarning}\n\n${pushResult.content[0].text}`,
      },
    ],
    ...(pushResult.isError ? { isError: true } : {}),
  };
}
