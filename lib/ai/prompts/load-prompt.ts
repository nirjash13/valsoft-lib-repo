/**
 * load-prompt — reads a versioned prompt Markdown file and parses its YAML frontmatter.
 *
 * Format (required):
 *   ---
 *   name: <string>
 *   version: <string>
 *   changed_in: <string>
 *   ---
 *   <body>
 *
 * No external YAML parser dependency — the frontmatter is simple flat key/value pairs
 * produced by our own tooling, so a hand-rolled parser is sufficient and avoids a
 * new production dependency.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptMeta {
  name: string;
  version: string;
  changedIn: string;
  /** Prompt body with frontmatter stripped. */
  body: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PromptParseError extends Error {
  override readonly name = "PromptParseError";
  constructor(filePath: string, detail: string) {
    super(`Failed to parse prompt file "${filePath}": ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// loadPrompt
// ---------------------------------------------------------------------------

/**
 * Reads the prompt `.md` file at `filePath`, parses its YAML frontmatter,
 * and returns the metadata + body.
 *
 * Reads synchronously — prompt files are tiny and are loaded once at startup
 * (or in a module-level `const`). Do not call inside hot paths.
 *
 * @param filePath - Absolute path to the prompt file.
 */
export function loadPrompt(filePath: string): PromptMeta {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (cause) {
    throw new PromptParseError(filePath, `Cannot read file — ${String(cause)}`);
  }

  return parsePrompt(filePath, raw);
}

/**
 * Resolves a prompt file relative to `lib/ai/prompts/` and loads it.
 *
 * @param filename - Bare filename, e.g. "readers-advisor.v1.md"
 */
export function loadPromptByName(filename: string): PromptMeta {
  const filePath = join(process.cwd(), "lib", "ai", "prompts", filename);
  return loadPrompt(filePath);
}

// ---------------------------------------------------------------------------
// parsePrompt — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Parses a raw prompt string (frontmatter + body).
 * Exported so unit tests can exercise the parsing logic without filesystem access.
 */
export function parsePrompt(filePath: string, raw: string): PromptMeta {
  const FENCE = "---";

  const firstFence = raw.indexOf(FENCE);
  if (firstFence !== 0) {
    throw new PromptParseError(filePath, 'File must start with "---"');
  }

  const secondFence = raw.indexOf(FENCE, firstFence + FENCE.length);
  if (secondFence === -1) {
    throw new PromptParseError(filePath, 'Missing closing "---" for frontmatter');
  }

  const frontmatterBlock = raw.slice(firstFence + FENCE.length, secondFence).trim();
  const body = raw.slice(secondFence + FENCE.length).trimStart();

  const fields = parseFlatYaml(filePath, frontmatterBlock);

  const name = fields.get("name");
  const version = fields.get("version");
  const changedIn = fields.get("changed_in");

  if (!name) throw new PromptParseError(filePath, 'Missing required frontmatter field "name"');
  if (!version)
    throw new PromptParseError(filePath, 'Missing required frontmatter field "version"');
  if (!changedIn)
    throw new PromptParseError(filePath, 'Missing required frontmatter field "changed_in"');
  if (!body) throw new PromptParseError(filePath, "Prompt body is empty");

  return { name, version, changedIn, body };
}

// ---------------------------------------------------------------------------
// parseFlatYaml — minimal key: value line parser (no nested structures)
// ---------------------------------------------------------------------------

function parseFlatYaml(filePath: string, block: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      throw new PromptParseError(filePath, `Invalid frontmatter line (no colon): "${line}"`);
    }

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (!key) {
      throw new PromptParseError(filePath, `Empty key in frontmatter line: "${line}"`);
    }

    result.set(key, value);
  }

  return result;
}
