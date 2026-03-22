/**
 * sync_push tool implementation
 * 
 * Commits and pushes .context/ directory to remote git.
 * Auto-generates SUMMARY.md, updates sync_meta.json, and writes .gitattributes.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getProjectRoot,
  ensureContextDir,
  writeContextFile,
  gitCommand,
  getAheadBehind,
  getDefaultRemote,
  getUpstreamRef,
  nowISO,
  getDeviceId,
  generateSummary,
  ensureGitattributes,
  CONTEXT_DIR,
} from "../utils.js";

function classifyPushFailure(errorMessage: string): { title: string; guidance: string } {
  const message = errorMessage.toLowerCase();

  if (message.includes("has no upstream branch")) {
    return {
      title: "This branch has no upstream remote yet.",
      guidance: "Create the upstream with `git push -u <remote> HEAD`, then run `/sync-save` again.",
    };
  }

  if (
    message.includes("authentication failed") ||
    message.includes("permission denied") ||
    message.includes("could not read from remote repository")
  ) {
    return {
      title: "Remote authentication failed.",
      guidance: "Check your Git credentials/SSH key, then push again.",
    };
  }

  if (
    message.includes("could not resolve host") ||
    message.includes("failed to connect") ||
    message.includes("connection timed out") ||
    message.includes("network is unreachable")
  ) {
    return {
      title: "Remote network check failed.",
      guidance: "Check your network connection and remote URL, then push again.",
    };
  }

  if (
    message.includes("does not appear to be a git repository") ||
    message.includes("no configured push destination")
  ) {
    return {
      title: "No valid remote push target is configured.",
      guidance: "Add/fix your git remote, then run `/sync-save` again.",
    };
  }

  return {
    title: "Push failed after creating a local context commit.",
    guidance: "Inspect the git error and push manually when ready.",
  };
}

function classifyRemoteCheckFailure(errorMessage: string): { title: string; guidance: string } {
  const message = errorMessage.toLowerCase();

  if (
    message.includes("authentication failed") ||
    message.includes("permission denied") ||
    message.includes("could not read from remote repository")
  ) {
    return {
      title: "Could not authenticate with the remote during preflight.",
      guidance: "Check your Git credentials/SSH key before running `/sync-save` again.",
    };
  }

  if (
    message.includes("could not resolve host") ||
    message.includes("failed to connect") ||
    message.includes("connection timed out") ||
    message.includes("network is unreachable")
  ) {
    return {
      title: "Could not reach the remote during preflight.",
      guidance: "Check your network connection and remote URL before trying `/sync-save` again.",
    };
  }

  if (
    message.includes("does not appear to be a git repository") ||
    message.includes("no such remote") ||
    message.includes("repository not found")
  ) {
    return {
      title: "The configured remote could not be used during preflight.",
      guidance: "Fix the remote URL or upstream configuration before trying `/sync-save` again.",
    };
  }

  return {
    title: "Could not confirm remote branch state during preflight.",
    guidance: "Resolve the git fetch issue first, then rerun `/sync-save`.",
  };
}

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

    // 2. Preflight remote state BEFORE generating new files / creating commits
    const upstreamRef = await getUpstreamRef(projectRoot);
    if (upstreamRef) {
      try {
        await gitCommand(projectRoot, "fetch", "--quiet");
        const { ahead, behind } = await getAheadBehind(projectRoot, upstreamRef);

        if (behind > 0 && ahead === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  "⚠️ Remote context is ahead of this branch.",
                  "",
                  "- **What happened**: another device or agent has already pushed newer `.context/` commits",
                  "- **Why save is blocked**: creating a new local sync commit first would make the branch harder to fast-forward",
                  "- **Recommended next step**: run `/sync-load` first, review the restored context, then run `/sync-save` again if you still have local updates",
                ].join("\n"),
              },
            ],
          };
        }

        if (behind > 0 && ahead > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  "⚠️ Local and remote context history have diverged.",
                  "",
                  "- **What happened**: this branch has local commits and the remote also has newer commits",
                  "- **Why save is blocked**: creating another sync commit now would make reconciliation messier",
                  "- **Recommended next step**: run `/sync-load` or reconcile the branch manually before trying `/sync-save` again",
                ].join("\n"),
              },
            ],
          };
        }
      } catch (error: any) {
        const classified = classifyRemoteCheckFailure(error.message);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "⚠️ Could not verify remote context state before saving.",
                "",
                `- **What happened**: ${classified.title}`,
                "- **Why save is blocked**: creating a new local sync commit while remote state is unknown can make reconciliation harder",
                `- **Recommended next step**: ${classified.guidance}`,
                "",
                "```text",
                error.message.split("\n")[0],
                "```",
              ].join("\n"),
            },
          ],
        };
      }
    }

    // 3. If summary provided, write it; otherwise auto-generate SUMMARY.md
    if (summary) {
      await writeContextFile(contextDir, "summary", summary);
    } else {
      const autoSummary = await generateSummary(projectRoot);
      await writeContextFile(contextDir, "summary", autoSummary);
    }

    // 4. Ensure .gitattributes exists (text normalization hint for Git)
    await ensureGitattributes(projectRoot);

    // 5. Write sync_meta.json
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

    // 6. Stage ONLY .context/ files
    await gitCommand(projectRoot, "add", `${CONTEXT_DIR}/`);

    // 7. git commit — use `--` path spec to commit ONLY .context/ files
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    await gitCommand(
      projectRoot,
      "commit",
      "-m",
      `context sync: ${timestamp}`,
      "--",
      `${CONTEXT_DIR}/`
    );

    // 8. git push
    try {
      await gitCommand(projectRoot, "push");
    } catch (error: any) {
      const remoteName = await getDefaultRemote(projectRoot);
      const classified = classifyPushFailure(error.message);
      const upstreamHint = error.message.toLowerCase().includes("has no upstream branch") && remoteName
        ? `\n- **Suggested command**: \`git push -u ${remoteName} HEAD\``
        : "";
      return {
        content: [
          {
            type: "text" as const,
            text: [
              "⚠️ Context was committed locally, but could not be pushed.",
              "",
              `- **What happened**: ${classified.title}`,
              `- **Next step**: ${classified.guidance}${upstreamHint}`,
              "",
              "```text",
              error.message.split("\n")[0],
              "```",
            ].join("\n"),
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
