/**
 * write_context tool implementation
 * 
 * Batch writes memory entries to .context/ files.
 * Supports "append" (for cumulative files) and "overwrite" (for state files).
 */

import {
  getProjectRoot,
  ensureContextDir,
  readContextFile,
  writeContextFile,
  findLastNumber,
  formatRelatedTo,
  countSections,
} from "../utils.js";

interface WriteEntry {
  file: "gotchas" | "architecture" | "api_notes" | "progress" | "summary";
  action: "append" | "overwrite";
  content: string;
  related_to?: string[];
}

export async function writeContext(entries: WriteEntry[], projectPath?: string) {
  try {
    const projectRoot = await getProjectRoot(projectPath);
    const contextDir = await ensureContextDir(projectRoot);

    const results: string[] = [];

    for (const entry of entries) {
      // Skip empty/whitespace-only entries
      if (!entry.content.trim()) {
        results.push(`⏩ Skipped empty entry for ${entry.file}`);
        continue;
      }

      if (entry.action === "append") {
        // Read existing content
        let existing = await readContextFile(contextDir, entry.file);

        // If file is empty, add a header
        if (!existing.trim()) {
          const headers: Record<string, string> = {
            gotchas: "# 避雷点 / 踩坑记录\n",
            architecture: "# 架构决策记录\n",
            api_notes: "# 接口行为说明\n",
          };
          existing = headers[entry.file] || `# ${entry.file}\n`;
        }

        // For numbered files, auto-increment the section number
        let contentToAppend = entry.content;
        if (entry.file === "gotchas" || entry.file === "architecture") {
          const lastNum = findLastNumber(existing);
          // Replace first "## " with "## N. " if it doesn't already have a number
          if (!/^## \d+\./m.test(contentToAppend)) {
            contentToAppend = contentToAppend.replace(
              /^## /m,
              `## ${lastNum + 1}. `
            );
          }
        }

        // Append related_to link if provided
        if (entry.related_to?.length) {
          contentToAppend += "\n" + formatRelatedTo(entry.related_to);
        }

        // Append to file
        const newContent = existing.trimEnd() + "\n\n" + contentToAppend.trim() + "\n";
        await writeContextFile(contextDir, entry.file, newContent);
        const count = (entry.file === "gotchas" || entry.file === "architecture")
          ? `now ${countSections(newContent)} entries`
          : `${newContent.trim().split("\n").length} lines`;
        results.push(`✅ Appended to ${entry.file} (${count})`);

      } else {
        // Overwrite mode
        let contentToWrite = entry.content;

        // Append related_to link if provided
        if (entry.related_to?.length) {
          contentToWrite += "\n" + formatRelatedTo(entry.related_to);
        }

        await writeContextFile(contextDir, entry.file, contentToWrite.trim() + "\n");
        const lineCount = contentToWrite.trim().split("\n").length;
        results.push(`✅ Overwrote ${entry.file} (${lineCount} lines)`);
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: results.join("\n") + `\n\n📁 Written to ${contextDir}`,
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
          text: `❌ Error writing context: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
