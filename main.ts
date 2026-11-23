// Token-radar entrypoint.
//
// Reads the sealed DefiLlama snapshot, scores every protocol through
// the model in ./lib/model.ts, and writes the ranked board, the
// dashboard's data file, the dashboard and screenshots, and the dossier
// the judge reads. Node 22, standard library only, no network, and the
// same input always produces the same bytes.
//
// Usage:
//   node main.ts --input <snapshot.json | directory> [--output <dir>]
// The input defaults to /input (that is, /input/snapshot.json) and the
// output to $MAKEFUN_OUTPUT_DIR, else /output.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardIssue, buildRadar, dataScript, parseSnapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = "/input";
const DEFAULT_OUTPUT = "/output";
const SNAPSHOT_NAME = "snapshot.json";

interface Flags {
  input: string;
  output: string | null;
}

function die(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

// Pull --input / --output out of argv, accepting both "--flag value"
// and "--flag=value" spellings. Anything else is left alone.
function readFlags(argv: string[]): Flags {
  const flags: Flags = { input: DEFAULT_INPUT, output: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (name: string): string | null => {
      if (arg === name) {
        const next = argv[i + 1];
        if (next === undefined) die(`error: ${name} needs a value`, 2);
        i += 1;
        return next;
      }
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      return null;
    };
    const inputValue = take("--input");
    if (inputValue !== null) {
      flags.input = inputValue;
      continue;
    }
    const outputValue = take("--output");
    if (outputValue !== null) {
      flags.output = outputValue;
    }
  }
  return flags;
}

// A snapshot argument may name the file itself or the directory that
// holds it; the default /input is a directory.
function snapshotPath(raw: string): string {
  try {
    if (statSync(raw).isDirectory()) return join(raw, SNAPSHOT_NAME);
  } catch {
    // Not an existing directory: treat it as a file path below.
  }
  return raw;
}

function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  const entries = readdirSync(from, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst);
    } else if (entry.isFile()) {
      copyFileSync(src, dst);
    }
  }
}

function run(): void {
  const flags = readFlags(process.argv.slice(2));
  const outDir =
    flags.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT;
  const snapFile = snapshotPath(flags.input);
  if (!existsSync(snapFile)) {
    die(`error: snapshot not found: ${snapFile}`, 2);
  }

  const snapshot = parseSnapshot(readFileSync(snapFile, "utf8"));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    die(issue, 1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "board.json"), `${JSON.stringify({ rows: board })}\n`, "utf8");
  writeFileSync(join(outDir, "data.js"), dataScript(radar), "utf8");

  // Fresh copies, so a stale file from an earlier run can never leak
  // into the output (and from there into the dossier).
  for (const name of ["dashboard", "screenshots"]) {
    rmSync(join(outDir, name), { recursive: true, force: true });
    copyTree(join(REPO_ROOT, name), join(outDir, name));
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const watchlistSize = radar.watchlist_size ?? snapshot.watchlist.length;
  console.log(
    `Token radar: ${snapshot.protocols.length} protocols scored, ` +
      `watchlist ${watchlistSize}, ${board.length} board rows -> ${outDir}`,
  );
}

run();
