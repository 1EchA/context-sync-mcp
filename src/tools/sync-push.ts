/**
 * sync_push tool implementation
 * 
 * Commits and pushes .context/ directory to remote git.
 * Auto-generates SUMMARY.md, updates sync_meta.json, ensures .gitattributes.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getProjectRoot,
  ensureContextDir,
  writeContextFile,
  gitCommand,
  nowISO,
  getDeviceId,
  generateSummary,
  ensureGitattributes,
  CONTEXT_DIR,
} from "../utils.js";

export async function syncPush(summary?: string, projectPath?: string) {
  try {
    const projectRoot = await getProjectRoot(projectPath);
    const contextDir = await ensureContextDir(projectRoot);

    // 1. Check if there are any .context/ changes (staged or unstaged)
    let hasContentChanges = false;
    try {
      const { stdout: diffOut } = await gitCommand(projectRoot, "diff", "--name-only", "--", `${CONTEXT_DIR}/`);
      if (diffOut.trim()) hasContentChanges = true;
    } catch { /* ignore */ }

    if (!hasContentChanges) {
      try {
        const { stdout: cachedOut } = await gitCommand(projectRoot, "diff", "--cached", "--name-only", "--", `${CONTEXT_DIR}/`);
        if (cachedOut.trim()) hasContentChanges = true;
      } catch { /* ignore */ }
    }

    if (!hasContentChanges) {
      try {
        const { stdout: untrackedOut } = await gitCommand(projectRoot, "ls-files", "--others", "--exclude-standard", `${CONTEXT_DIR}/`);
        if (untrackedOut.trim()) hasContentChanges = true;
      } catch { /* ignore */ }
    }

    if (!hasContentChanges) {
      return {
        content: [
          {
            type: "text" as const,
            text: "ℹ️ No changes to push. Context files are already up to date.",
          },
        ],
      };
    }

    // 2. If summary provided, write it; otherwise auto-generate SUMMARY.md
    if (summary) {
      await writeContextFile(contextDir, "summary", summary);
    } else {
      const autoSummary = await generateSummary(projectRoot);
      await writeContextFile(contextDir, "summary", autoSummary);
    }

    // 3. Ensure .gitattributes exists (merge=ours strategy)
    await ensureGitattributes(projectRoot);

    // 4. Write sync_meta.json
    const meta = {
      last_sync: nowISO(),
      device: getDeviceId(),
      agent: process.env.AGENT_TYPE || "unknown",
    };
    await writeFile(
      join(contextDir, "sync_meta.json"),
      JSON.stringify(meta, null, 2) + "\n",
      "utf-8"
    );

    // 5. Stage ONLY .context/ files
    await gitCommand(projectRoot, "add", `${CONTEXT_DIR}/`);

    // 6. git commit — use `--` path spec to commit ONLY .context/ files
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    await gitCommand(
      projectRoot,
      "commit",
      "-m",
      `context sync: ${timestamp}`,
      "--",
      `${CONTEXT_DIR}/`
    );

    // 7. git push
    try {
      await gitCommand(projectRoot, "push");
    } catch (error: any) {
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Committed locally, but push failed:\n${error.message}\n\nYou can manually push later with: git push`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `✅ Context synced successfully!\n📤 Pushed to remote\n⏰ ${timestamp}\n💻 Device: ${meta.device}`,
        },
      ],
    };
  } catch (error: any) {
    if (error.message === "NOT_GIT_REPO") {
      return {
        content: [
          {
            type: "text" as const,
            text: "❌ Not in a git repository. Please navigate to a git project first.",
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `❌ Sync push failed: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
