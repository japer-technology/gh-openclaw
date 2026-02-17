/**
 * GitHub Mode Bundle Builder
 *
 * Builds a timestamped zip file containing all GitHub Mode components.
 * The zip can be extracted ("exploded") into any OpenClaw fork to install
 * or update GitHub Mode.
 *
 * Usage:
 *   node --import tsx scripts/build-github-mode-bundle.ts
 *   pnpm github-mode:bundle
 *
 * Options:
 *   --output-dir <dir>  Directory for the output zip (default: current directory).
 *   --dry-run           List files that would be included without creating the zip.
 */

import JSZip from "jszip";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// ── Component registry ───────────────────────────────────────────────

export type ComponentGroup = {
  id: string;
  label: string;
  description: string;
  /** Paths relative to repo root. Trailing `/` means directory. */
  paths: string[];
};

/**
 * All GitHub Mode component groups bundled into the zip.
 * Paths are relative to the repository root.
 */
export const COMPONENT_GROUPS: ComponentGroup[] = [
  {
    id: "runtime-contracts",
    label: "Runtime Contracts",
    description:
      "Machine-readable runtime contracts, schemas, and policies that define GitHub Mode behavior.",
    paths: ["runtime/github/"],
  },
  {
    id: "workflows",
    label: "GitHub Actions Workflows",
    description:
      "GitHub Mode CI/CD workflows for contract validation, commands, and policy enforcement.",
    paths: [".github/workflows/github-mode-contracts.yml"],
  },
  {
    id: "docs",
    label: "GitHub Mode Documentation",
    description: "Architecture docs, ADRs, security analysis, planning, and implementation guides.",
    paths: ["docs/github-mode/"],
  },
  {
    id: "validation-scripts",
    label: "Validation Scripts",
    description: "Contract validation and upstream-additive-change guard scripts.",
    paths: [
      "scripts/validate-github-runtime-contracts.ts",
      "scripts/check-upstream-additions-only.ts",
      "scripts/build-github-mode-bundle.ts",
    ],
  },
  {
    id: "tests",
    label: "Test Coverage",
    description: "Test suites for contract validation and upstream-additions guard.",
    paths: [
      "test/validate-github-runtime-contracts.test.ts",
      "test/check-upstream-additions-only.test.ts",
      "test/build-github-mode-bundle.test.ts",
    ],
  },
  {
    id: "entrypoints",
    label: "Repository Entrypoints",
    description: "Top-level GitHub Mode README files for fork orientation.",
    paths: [".GITHUB-MODE-ACTIVE.md", ".GITHUB-MODE-README.md"],
  },
];

// ── File collection ──────────────────────────────────────────────────

export type BundleEntry = {
  /** Path relative to repo root, used as the zip entry path. */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** Component group this file belongs to. */
  groupId: string;
};

/**
 * Collect all files that should be included in the bundle.
 */
export function collectBundleEntries(repoRoot: string): BundleEntry[] {
  const entries: BundleEntry[] = [];

  for (const group of COMPONENT_GROUPS) {
    for (const p of group.paths) {
      const absolutePath = path.join(repoRoot, p);
      if (!existsSync(absolutePath)) {
        continue;
      }
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        collectDirRecursive(absolutePath, repoRoot, group.id, entries);
      } else {
        entries.push({
          relativePath: p,
          absolutePath,
          groupId: group.id,
        });
      }
    }
  }

  return entries;
}

function collectDirRecursive(
  dir: string,
  repoRoot: string,
  groupId: string,
  out: BundleEntry[],
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDirRecursive(fullPath, repoRoot, groupId, out);
    } else {
      out.push({
        relativePath: path.relative(repoRoot, fullPath),
        absolutePath: fullPath,
        groupId,
      });
    }
  }
}

// ── Bundle name generation ───────────────────────────────────────────

/**
 * Generate a timestamped bundle filename.
 * Format: gitclaw-YYYY-MM-DD-HH-MM.zip
 */
export function generateBundleName(date?: Date): string {
  const d = date ?? new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  return `gitclaw-${yyyy}-${mm}-${dd}-${hh}-${min}.zip`;
}

// ── Zip creation ─────────────────────────────────────────────────────

export type BuildResult = {
  /** Absolute path to the created zip file (undefined if dry-run). */
  outputPath: string | undefined;
  /** Number of files included in the bundle. */
  fileCount: number;
  /** Bundle entries included. */
  entries: BundleEntry[];
  /** Size of the zip in bytes (0 if dry-run). */
  sizeBytes: number;
};

/**
 * Build the GitHub Mode zip bundle.
 */
export async function buildBundle(options: {
  repoRoot: string;
  outputDir: string;
  dryRun: boolean;
  bundleName?: string;
}): Promise<BuildResult> {
  const entries = collectBundleEntries(options.repoRoot);
  const bundleName = options.bundleName ?? generateBundleName();

  if (options.dryRun) {
    return {
      outputPath: undefined,
      fileCount: entries.length,
      entries,
      sizeBytes: 0,
    };
  }

  const zip = new JSZip();

  for (const entry of entries) {
    const content = readFileSync(entry.absolutePath);
    zip.file(entry.relativePath, content);
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const outputPath = path.join(options.outputDir, bundleName);
  writeFileSync(outputPath, zipBuffer);

  return {
    outputPath,
    fileCount: entries.length,
    entries,
    sizeBytes: zipBuffer.length,
  };
}

// ── CLI entrypoint ───────────────────────────────────────────────────

export type BundleOptions = {
  repoRoot: string;
  outputDir: string;
  dryRun: boolean;
};

export function parseArgs(argv: string[]): BundleOptions | { error: string } {
  const args = argv.slice(2);
  let outputDir: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--output-dir") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        return { error: "--output-dir requires a directory argument." };
      }
      outputDir = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      return {
        error:
          "Usage: pnpm github-mode:bundle [--output-dir <dir>] [--dry-run]\n\n" +
          "Builds a timestamped zip bundle of all GitHub Mode components.\n" +
          "The zip can be extracted into any OpenClaw fork to install or update.\n\n" +
          "Options:\n" +
          "  --output-dir <dir>  Directory for the output zip (default: repo root).\n" +
          "  --dry-run           List files without creating the zip.\n" +
          "  --help, -h          Show this help message.\n\n" +
          "Output:\n" +
          "  gitclaw-YYYY-MM-DD-HH-MM.zip\n\n" +
          "Install into a fork:\n" +
          "  unzip gitclaw-*.zip -d /path/to/your/fork\n",
      };
    } else if (!arg.startsWith("-")) {
      // Positional arg treated as output dir for convenience
      outputDir = arg;
    } else {
      return { error: `Unknown option: ${arg}` };
    }
  }

  const repoRoot = process.cwd();
  const resolvedOutputDir = outputDir ? path.resolve(outputDir) : repoRoot;

  if (!existsSync(resolvedOutputDir)) {
    return { error: `Output directory does not exist: ${resolvedOutputDir}` };
  }

  return { repoRoot, outputDir: resolvedOutputDir, dryRun };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }

  console.log("🦞 OpenClaw GitHub Mode — Bundle Builder\n");

  if (parsed.dryRun) {
    console.log("  [DRY RUN] No files will be created.\n");
  }

  // Verify source
  const manifestPath = path.join(parsed.repoRoot, "runtime/github/runtime-manifest.json");
  if (!existsSync(manifestPath)) {
    console.error("❌ Not an OpenClaw repo root (missing runtime/github/runtime-manifest.json).");
    console.error("   Run this script from the OpenClaw repository root.\n");
    process.exit(1);
  }

  const result = await buildBundle({
    repoRoot: parsed.repoRoot,
    outputDir: parsed.outputDir,
    dryRun: parsed.dryRun,
  });

  // Print component summary
  console.log("Components included:\n");
  for (const group of COMPONENT_GROUPS) {
    const groupEntries = result.entries.filter((e) => e.groupId === group.id);
    console.log(`  ✅ ${group.label} (${groupEntries.length} files)`);
    console.log(`     ${group.description}`);
  }
  console.log();

  // Print file listing
  console.log(`Files (${result.fileCount} total):\n`);
  for (const entry of result.entries) {
    console.log(`  ${entry.relativePath}`);
  }
  console.log();

  if (parsed.dryRun) {
    console.log(`Would bundle ${result.fileCount} files.\n`);
  } else {
    console.log(`Bundle: ${result.outputPath}`);
    console.log(`Size:   ${formatBytes(result.sizeBytes)}`);
    console.log(`Files:  ${result.fileCount}\n`);

    console.log("Install into your fork:\n");
    console.log(`  unzip -o ${path.basename(result.outputPath!)} -d /path/to/your/fork\n`);
    console.log("Then:");
    console.log("  cd /path/to/your/fork");
    console.log("  pnpm install");
    console.log("  pnpm contracts:github:validate");
    console.log("  git add -A && git commit -m 'chore: install GitHub Mode components'");
    console.log("  git push\n");
    console.log("See docs/github-mode/fork-installation.md for the full guide.");
  }

  console.log("\n🦞 Done.\n");
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("build-github-mode-bundle.ts")
) {
  void main();
}
