/**
 * sync_load tool implementation
 * 
 * Pulls latest context from remote git and returns .context/ file contents.
 * Includes guided onboarding for new devices and sync_meta info display.
 */

import {
  getProjectRoot,
  resolveBasePath,
  hasGitRepo,
  hasContextFiles,
  getAheadBehind,
  readAllContextFiles,
  readContextFile,
  readSyncMeta,
  getUpstreamRef,
  gitCommand,
  CONTEXT_DIR,
  FILE_MAP,
} from "../utils.js";
import { join } from "node:path";

export async function syncLoad(topic?: string, projectPath?: string) {
  const cwd = resolveBasePath(projectPath);

  // Step 1: Check if we're in a git repo
  const isGitRepo = await hasGitRepo(cwd);
  if (!isGitRepo) {
    return {
      content: [
        {
          type: "text" as const,
          text: [
            "📋 **New Device Setup Guide**",
            "",
            "No git repository found in the current directory.",
            "Please clone your project first:",
            "",
            "```bash",
            "git clone <your-repo-url> .",
            "```",
            "",
            "Then run `/sync-load` again.",
          ].join("\n"),
        },
      ],
    };
  }

  // Step 2: inspect remote state and pull only when a fast-forward is possible
  let projectRoot: string;
  try {
    projectRoot = await getProjectRoot(projectPath);
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: "❌ Could not determine project root. Make sure you're inside a git repository.",
        },
      ],
      isError: true,
    };
  }

  let pullWarning = "";
  const upstreamRef = await getUpstreamRef(projectRoot);

  if (!upstreamRef) {
    pullWarning = "\n\n⚠️ **Warning**: no upstream branch is configured — showing local context only.\n" +
      "> Configure a remote/upstream before relying on cross-device sync.";
  } else {
    try {
      await gitCommand(projectRoot, "fetch", "--quiet");
      const { ahead, behind } = await getAheadBehind(projectRoot, upstreamRef);

      if (ahead > 0 && behind > 0) {
        pullWarning = "\n\n⚠️ **Warning**: local and remote history have diverged — showing local context only.\n" +
          "> Reconcile the branch before relying on `/sync-load` to restore the latest shared state.";
      } else if (behind > 0) {
        try {
          await gitCommand(projectRoot, "pull", "--ff-only");
        } catch (error: any) {
          pullWarning = "\n\n⚠️ **Warning**: remote has newer context, but fast-forward pull could not be applied cleanly.\n" +
            "> You may have local `.context/` changes or local commits blocking the update.\n" +
            `> ${error.message.split("\n")[0]}`;
        }
      } else if (ahead > 0) {
        pullWarning = "\n\nℹ️ **Info**: local context includes unpushed commits — showing local context as-is.\n" +
          "> The remote may be behind this device until you run `/sync-save`.";
      }
    } catch (error: any) {
      pullWarning = "\n\n⚠️ **Warning**: could not check remote state — showing local context only.\n" +
        "> This is usually caused by a network, authentication, or remote URL issue.\n" +
        `> ${error.message.split("\n")[0]}`;
    }
  }

  // Step 3: Check if .context/ exists
  const hasContext = await hasContextFiles(projectRoot);
  if (!hasContext) {
    return {
      content: [
        {
          type: "text" as const,
          text: [
            "ℹ️ **No sync context found**",
            "",
            "No `.context/` directory found in this project.",
            "This could mean:",
            "- No one has run `/sync-save` yet on another device",
            "- The context hasn't been pushed to this branch",
            "",
            "You can start working and use `/sync-save` when ready to sync.",
          ].join("\n"),
        },
      ],
    };
  }

  // Step 4: Read sync_meta for display
  const meta = await readSyncMeta(projectRoot);
  let metaLine = "";
  if (meta) {
    const syncTime = new Date(meta.last_sync).toISOString().replace("T", " ").slice(0, 19);
    metaLine = `\n> 📌 Last sync: ${syncTime} | 💻 Device: ${meta.device} | 🤖 Agent: ${meta.agent}`;
  }

  // Step 5: Load files
  if (topic) {
    // Load a specific topic
    const fileKey = Object.keys(FILE_MAP).find(
      (k) => k === topic || FILE_MAP[k] === topic
    );
    if (!fileKey) {
      return {
        content: [
          {
            type: "text" as const,
            text: `❌ Unknown topic: "${topic}". Available: ${Object.keys(FILE_MAP).join(", ")}`,
          },
        ],
        isError: true,
      };
    }
    const contextDir = join(projectRoot, CONTEXT_DIR);
    const content = await readContextFile(contextDir, fileKey);
    if (!content) {
      return {
        content: [
          {
            type: "text" as const,
            text: `ℹ️ No content found for topic "${topic}".`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `📂 **${FILE_MAP[fileKey]}**${metaLine}${pullWarning}\n\n${content}`,
        },
      ],
    };
  }

  // Load all files in priority order
  const files = await readAllContextFiles(projectRoot);

  if (files.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "ℹ️ Context directory exists but all files are empty.",
        },
      ],
    };
  }

  const output = files.map((f) => {
    return `## 📂 ${f.filename}\n\n${f.content}`;
  }).join("\n\n---\n\n");

  return {
    content: [
      {
        type: "text" as const,
        text: `✅ **Context restored** (${files.length} files loaded)${metaLine}${pullWarning}\n\n---\n\n${output}`,
      },
    ],
  };
}
