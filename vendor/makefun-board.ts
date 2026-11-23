// Dossier builder for the token-radar entry.
//
// Reads the finished output directory -- the dashboard/ tree and the
// screenshots/ folder -- and packs them into the single dossier.json
// document the judge reads: the screenshots as base64 images plus a
// plain-text rendering of every dashboard source file.
//
// Only the Node standard library is used, and the output is fully
// deterministic: files are visited in path order, nothing carries a
// timestamp, and the JSON is written compact with fixed key order.

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";

export interface DossierCaps {
  text_max_bytes: number;
  screenshots?: { max: number; max_bytes: number };
  dashboard?: { max_files: number; max_bytes: number };
}

interface ShotCaps {
  max: number;
  max_bytes: number;
}

interface DashCaps {
  max_files: number;
  max_bytes: number;
}

interface PackedFile {
  rel: string;
  size: number;
  source: string | null;
  lines: number;
}

interface PackedShot {
  base64: string;
  media_type: string;
  name: string;
  sha256: string;
}

const SCHEMA = "makefun/dossier/v1";
const DOSSIER_MAX_BYTES = 1572864;
const FALLBACK_TEXT = 65536;
const FALLBACK_SHOTS: ShotCaps = { max: 4, max_bytes: 524288 };
const FALLBACK_DASH: DashCaps = { max_files: 400, max_bytes: 4194304 };
const NAME_OK = /^[A-Za-z0-9._-]+$/;
const TEXT_BY_EXT: Record<string, string> = {
  ".html": "html",
  ".css": "css",
  ".js": "js",
  ".mjs": "js",
  ".json": "json",
  ".svg": "svg",
  ".md": "md",
  ".txt": "text",
};

function fail(message: string): never {
  throw new Error(`buildDossier: ${message}`);
}

function lowerExt(name: string): string {
  const at = name.lastIndexOf(".");
  return at < 0 ? "" : name.slice(at).toLowerCase();
}

function checkName(name: string, what: string): void {
  if (
    name.length < 1 ||
    name.length > 128 ||
    name.startsWith(".") ||
    name.startsWith("-") ||
    !NAME_OK.test(name)
  ) {
    fail(`${what} has a refused name: ${name}`);
  }
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") seen += 1;
  }
  return text.endsWith("\n") ? seen : seen + 1;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Walk the dashboard tree depth-first, collecting every regular file
// under its slash-separated relative path, in sorted path order.
function collectDashboard(root: string, caps: DashCaps): PackedFile[] {
  if (!existsSync(root)) fail(`dashboard directory is missing: ${root}`);
  const found: PackedFile[] = [];
  let total = 0;

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        fail(`dashboard holds a hidden entry: ${entry.name}`);
      }
      checkName(entry.name, "dashboard file");
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const bytes = readFileSync(full);
        const rel = relative(root, full).split(sep).join("/");
        total += bytes.length;
        if (found.length + 1 > caps.max_files) {
          fail(`dashboard holds more than ${caps.max_files} files`);
        }
        if (total > caps.max_bytes) {
          fail(`dashboard holds more than ${caps.max_bytes} bytes`);
        }
        const fence = TEXT_BY_EXT[lowerExt(entry.name)];
        let source: string | null = null;
        let lines = 0;
        if (fence !== undefined) {
          try {
            source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            fail(`dashboard file is not plain UTF-8 text: ${rel}`);
          }
          lines = countLines(source);
        }
        found.push({ rel, size: bytes.length, source, lines });
      } else {
        fail(`dashboard holds a file that is not plain: ${entry.name}`);
      }
    }
  };

  walk(root);
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return found;
}

function collectShots(root: string, caps: ShotCaps): PackedShot[] {
  if (!existsSync(root)) fail(`screenshots directory is missing: ${root}`);
  const names = readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .sort();
  if (names.length === 0) fail("no screenshots found");
  if (names.length > caps.max) {
    fail(`more than ${caps.max} screenshots`);
  }
  const shots: PackedShot[] = [];
  for (const name of names) {
    checkName(name, "screenshot");
    const full = join(root, name);
    const stat = lstatSync(full);
    if (!stat.isFile()) fail(`screenshot is not a plain file: ${name}`);
    const bytes = readFileSync(full);
    if (bytes.length > caps.max_bytes) {
      fail(`screenshot is past its byte cap: ${name}`);
    }
    const ext = lowerExt(name);
    let media: string;
    if (ext === ".png") {
      if (!isPng(bytes)) fail(`screenshot is not a whole PNG: ${name}`);
      media = "image/png";
    } else if (ext === ".jpg" || ext === ".jpeg") {
      if (!isJpeg(bytes)) fail(`screenshot is not a whole JPEG: ${name}`);
      media = "image/jpeg";
    } else {
      fail(`screenshot is not a PNG or JPEG: ${name}`);
    }
    shots.push({
      base64: bytes.toString("base64"),
      media_type: media,
      name,
      sha256: sha256Hex(bytes),
    });
  }
  return shots;
}

// Render one file's whole source section, exactly as the dossier shows
// it: a heading, its size and line count, then the contents in a fence
// named after the file's language.
function wholeSection(file: PackedFile): string {
  const fence = TEXT_BY_EXT[lowerExt(file.rel)] ?? "";
  return (
    `\n### ${file.rel}\n\n${file.size} bytes, ${file.lines} lines\n\n` +
    `\`\`\`${fence}\n${file.source ?? ""}\`\`\`\n`
  );
}

// Render the dossier text. Files go in whole, in path order, while the
// budget allows. The first file that does not fit goes in up to its last
// complete line inside the budget, followed by a line saying how many of
// its lines were left out; the text then closes with one line naming how
// many whole files, and how many bytes of them, were left out entirely.
function renderText(files: PackedFile[], budget: number): string {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let head = `## Dashboard\n\nFiles: ${files.length} (${totalBytes} bytes)\n`;
  for (const file of files) {
    head += `- ${file.rel} (${file.size} bytes)\n`;
  }
  head += `\n## Source\n`;

  const shown = files.filter((file) => file.source !== null);
  const sections = shown.map((file) => wholeSection(file));
  const whole = head + sections.join("");
  if (Buffer.byteLength(whole, "utf8") <= budget) return whole;

  let out = head;
  let used = Buffer.byteLength(out, "utf8");
  for (let i = 0; i < shown.length; i += 1) {
    const file = shown[i];
    const rest = shown.slice(i + 1);
    const restBytes = rest.reduce((sum, other) => sum + other.size, 0);
    const section = sections[i];
    if (used + Buffer.byteLength(section, "utf8") <= budget) {
      out += section;
      used += Buffer.byteLength(section, "utf8");
      continue;
    }
    const fence = TEXT_BY_EXT[lowerExt(file.rel)] ?? "";
    const opening =
      `\n### ${file.rel}\n\n${file.size} bytes, ${file.lines} lines\n\n` +
      `\`\`\`${fence}\n`;
    const closing = "```\n";
    const tail =
      rest.length === 0
        ? ""
        : `${rest.length} files (${restBytes} bytes) not shown\n`;
    const lines = splitLines(file.source ?? "");
    let kept = 0;
    let room =
      budget -
      used -
      Buffer.byteLength(opening, "utf8") -
      Buffer.byteLength(closing, "utf8") -
      Buffer.byteLength(tail, "utf8");
    while (kept < lines.length) {
      const hidden = lines.length - kept;
      const candidate = `${hidden} lines not shown\n`;
      const lineBytes = Buffer.byteLength(`${lines[kept]}\n`, "utf8");
      if (lineBytes + Buffer.byteLength(candidate, "utf8") > room) break;
      room -= lineBytes;
      kept += 1;
    }
    const hidden = lines.length - kept;
    const noteText = hidden > 0 ? `${hidden} lines not shown\n` : "";
    out += opening;
    for (let k = 0; k < kept; k += 1) out += `${lines[k]}\n`;
    out += noteText;
    out += closing;
    out += tail;
    return out;
  }
  return out;
}

export function buildDossier(dir: string, caps: DossierCaps): Uint8Array {
  const textCap =
    caps.text_max_bytes !== undefined && caps.text_max_bytes !== null
      ? caps.text_max_bytes
      : FALLBACK_TEXT;
  const shotCaps: ShotCaps = {
    max: caps.screenshots?.max ?? FALLBACK_SHOTS.max,
    max_bytes: caps.screenshots?.max_bytes ?? FALLBACK_SHOTS.max_bytes,
  };
  const dashCaps: DashCaps = {
    max_files: caps.dashboard?.max_files ?? FALLBACK_DASH.max_files,
    max_bytes: caps.dashboard?.max_bytes ?? FALLBACK_DASH.max_bytes,
  };

  const files = collectDashboard(join(dir, "dashboard"), dashCaps);
  const images = collectShots(join(dir, "screenshots"), shotCaps);
  const text = renderText(files, textCap);

  const dossier = {
    cover: 0,
    images,
    schema: SCHEMA,
    text,
  };
  const bytes = Buffer.from(JSON.stringify(dossier), "utf8");
  if (bytes.length > DOSSIER_MAX_BYTES) {
    fail(`dossier is past 1.5 MiB (${bytes.length} bytes)`);
  }
  return bytes;
}
