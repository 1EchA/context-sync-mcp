/**
 * Utility functions for file system and git operations
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The .context directory name */
export const CONTEXT_DIR = ".context";

/** Map file key to actual filename */
export const FILE_MAP: Record<string, string> = {
  gotchas: "gotchas.md",
  architecture: "architecture.md",
  api_notes: "api_notes.md",
  progress: "task_progress.md",
  summary: "SUMMARY.md",
};

/**
 * Get the project root directory (where .git is located).
 * Walks up from cwd until it finds .git or hits root.
 */
export async function getProjectRoot(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
    });
    return stdout.trim();
  } catch {
    throw new Error("NOT_GIT_REPO");
  }
}

/**
 * Ensure .context directory exists
 */
export async function ensureContextDir(projectRoot: string): Promise<string> {
  const contextPath = join(projectRoot, CONTEXT_DIR);
  await mkdir(contextPath, { recursive: true });
  return contextPath;
}

/**
 * Read a context file, returns empty string if not exists
 */
export async function readContextFile(contextDir: string, fileKey: string): Promise<string> {
  const filename = FILE_MAP[fileKey];
  if (!filename) throw new Error(`Unknown file key: ${fileKey}`);
  const filepath = join(contextDir, filename);
  try {
    return await readFile(filepath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Write content to a context file (skips if content unchanged)
 */
export async function writeContextFile(contextDir: string, fileKey: string, content: string): Promise<void> {
  const filename = FILE_MAP[fileKey];
  if (!filename) throw new Error(`Unknown file key: ${fileKey}`);
  const filepath = join(contextDir, filename);
  // Skip write if content is identical (avoids unnecessary git dirty state)
  try {
    const existing = await readFile(filepath, "utf-8");
    if (existing === content) return;
  } catch { /* file doesn't exist yet, proceed with write */ }
  await writeFile(filepath, content, "utf-8");
}

/**
 * Find the last numbered section in markdown content (## N. Title)
 * Returns the number, or 0 if none found
 */
export function findLastNumber(content: string): number {
  // Strip fenced code blocks to avoid false positives (e.g. "## 99." inside ```...```)
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  const matches = stripped.matchAll(/^## (\d+)\./gm);
  let last = 0;
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (n > last) last = n;
  }
  return last;
}

/**
 * Generate a related_to Markdown line
 */
export function formatRelatedTo(relatedTo: string[]): string {
  if (!relatedTo.length) return "";
  const links = relatedTo.map((id) => {
    // Convert IDs like "ADR-1" → [ADR-1](architecture.md#adr-1)
    // "Gotcha#2" or "踩坑#2" → [踩坑#2](gotchas.md#2)
    if (/^ADR-/i.test(id)) {
      const anchor = id.toLowerCase().replace(/\s+/g, "-");
      return `[${id}](architecture.md#${anchor})`;
    }
    if (/gotcha|踩坑/i.test(id)) {
      const num = id.match(/\d+/)?.[0] || "";
      return `[${id}](gotchas.md#${num})`;
    }
    // fallback: just use the id as-is
    return `[${id}]`;
  });
  return `- **关联**：${links.join("，")}`;
}

/**
 * Run a git command in the project root
 */
export async function gitCommand(projectRoot: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("git", args, { cwd: projectRoot });
  } catch (error: any) {
    throw new Error(`Git error: ${error.message}\n${error.stderr || ""}`);
  }
}

/**
 * Check if .git exists at the given path
 */
export async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if .context directory exists and has content files (.md)
 */
export async function hasContextFiles(projectRoot: string): Promise<boolean> {
  try {
    const contextDir = join(projectRoot, CONTEXT_DIR);
    const files = await readdir(contextDir);
    // Only count .md files (ignore .gitattributes, sync_meta.json, etc.)
    return files.some(f => f.endsWith(".md"));
  } catch {
    return false;
  }
}

/**
 * Read all context files and return them in priority order
 */
export async function readAllContextFiles(projectRoot: string): Promise<Array<{ file: string; filename: string; content: string }>> {
  const contextDir = join(projectRoot, CONTEXT_DIR);
  const priorityOrder = ["summary", "progress", "gotchas", "architecture", "api_notes"];
  // Read all files in parallel for better performance
  const entries = await Promise.all(
    priorityOrder.map(async (key) => {
      const content = await readContextFile(contextDir, key);
      return content ? { file: key, filename: FILE_MAP[key], content } : null;
    })
  );

  return entries.filter((e): e is NonNullable<typeof e> => e !== null);
}

/**
 * Get current timestamp in ISO format
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Get device identifier (hostname)
 */
export function getDeviceId(): string {
  return hostname() || process.env.HOSTNAME || process.env.COMPUTERNAME || "unknown";
}

/**
 * Read sync_meta.json, returns null if not exists
 */
export async function readSyncMeta(projectRoot: string): Promise<{ last_sync: string; device: string; agent: string } | null> {
  try {
    const raw = await readFile(join(projectRoot, CONTEXT_DIR, "sync_meta.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Auto-generate SUMMARY.md from existing .context/ files
 */
export async function generateSummary(projectRoot: string): Promise<string> {
  const contextDir = join(projectRoot, CONTEXT_DIR);
  const meta = await readSyncMeta(projectRoot);
  const timestamp = meta?.last_sync
    ? new Date(meta.last_sync).toISOString().replace("T", " ").slice(0, 19)
    : new Date().toISOString().replace("T", " ").slice(0, 19);
  const device = meta?.device || getDeviceId();
  const agent = meta?.agent || "unknown";

  const lines: string[] = [
    "# 项目上下文索引",
    "",
    `> 最后同步: ${timestamp} | 设备: ${device} | Agent: ${agent}`,
    "",
    "## 详细主题",
  ];

  const topicFiles = ["progress", "gotchas", "architecture", "api_notes"] as const;
  for (const key of topicFiles) {
    const content = await readContextFile(contextDir, key);
    if (content) {
      const lineCount = content.trim().split("\n").length;
      lines.push(`- [${FILE_MAP[key]}](./${FILE_MAP[key]}) — ${lineCount} lines`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Ensure .context/.gitattributes exists with merge=ours strategy
 */
export async function ensureGitattributes(projectRoot: string): Promise<void> {
  const filepath = join(projectRoot, CONTEXT_DIR, ".gitattributes");
  const content = `# Auto merge strategy: last-push wins (avoid conflicts)\n*.md merge=ours\nsync_meta.json merge=ours\n`;
  try {
    await readFile(filepath, "utf-8");
    // File already exists, don't overwrite
  } catch {
    await writeFile(filepath, content, "utf-8");
  }
}

/**
 * Count numbered sections (## N.) in a file
 */
export function countSections(content: string): number {
  const stripped = content.replace(/```[\s\S]*?```/g, "");
  const matches = [...stripped.matchAll(/^## \d+\./gm)];
  return matches.length;
}
