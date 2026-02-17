import JSZip from "jszip";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPONENT_GROUPS,
  buildBundle,
  collectBundleEntries,
  generateBundleName,
  parseArgs,
} from "../scripts/build-github-mode-bundle.js";

const ROOT = process.cwd();

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "github-mode-bundle-test-"));
}

describe("build-github-mode-bundle", () => {
  describe("COMPONENT_GROUPS", () => {
    it("has at least 5 component groups", () => {
      expect(COMPONENT_GROUPS.length).toBeGreaterThanOrEqual(5);
    });

    it("every group has required fields", () => {
      for (const group of COMPONENT_GROUPS) {
        expect(group.id).toBeTruthy();
        expect(group.label).toBeTruthy();
        expect(group.description).toBeTruthy();
        expect(group.paths.length).toBeGreaterThan(0);
      }
    });

    it("includes runtime-contracts group", () => {
      const group = COMPONENT_GROUPS.find((g) => g.id === "runtime-contracts");
      expect(group).toBeDefined();
      expect(group?.paths).toContain("runtime/github/");
    });

    it("includes workflows group", () => {
      const group = COMPONENT_GROUPS.find((g) => g.id === "workflows");
      expect(group).toBeDefined();
    });
  });

  describe("generateBundleName", () => {
    it("generates a timestamped filename", () => {
      const name = generateBundleName(new Date("2026-02-17T20:15:00Z"));
      expect(name).toBe("gitclaw-2026-02-17-20-15.zip");
    });

    it("pads single-digit months and days", () => {
      const name = generateBundleName(new Date("2026-01-05T03:09:00Z"));
      expect(name).toBe("gitclaw-2026-01-05-03-09.zip");
    });

    it("generates a name without arguments", () => {
      const name = generateBundleName();
      expect(name).toMatch(/^gitclaw-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
    });
  });

  describe("collectBundleEntries", () => {
    it("collects files from the real repo", () => {
      const entries = collectBundleEntries(ROOT);
      expect(entries.length).toBeGreaterThan(10);
    });

    it("includes runtime-manifest.json", () => {
      const entries = collectBundleEntries(ROOT);
      const manifest = entries.find(
        (e) => e.relativePath === "runtime/github/runtime-manifest.json",
      );
      expect(manifest).toBeDefined();
      expect(manifest?.groupId).toBe("runtime-contracts");
    });

    it("includes workflow files", () => {
      const entries = collectBundleEntries(ROOT);
      const workflow = entries.find((e) => e.relativePath.includes("github-mode-contracts.yml"));
      expect(workflow).toBeDefined();
      expect(workflow?.groupId).toBe("workflows");
    });

    it("includes entrypoint files", () => {
      const entries = collectBundleEntries(ROOT);
      const active = entries.find((e) => e.relativePath === ".GITHUB-MODE-ACTIVE.md");
      expect(active).toBeDefined();
      expect(active?.groupId).toBe("entrypoints");
    });

    it("all entries have absolute paths that exist", () => {
      const entries = collectBundleEntries(ROOT);
      for (const entry of entries) {
        expect(existsSync(entry.absolutePath)).toBe(true);
      }
    });
  });

  describe("buildBundle", () => {
    it("creates a zip file", async () => {
      const tmp = makeTempDir();
      try {
        const result = await buildBundle({
          repoRoot: ROOT,
          outputDir: tmp,
          dryRun: false,
          bundleName: "test-bundle.zip",
        });

        expect(result.outputPath).toBeDefined();
        expect(result.fileCount).toBeGreaterThan(10);
        expect(result.sizeBytes).toBeGreaterThan(0);
        expect(existsSync(result.outputPath!)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("zip contains correct file paths", async () => {
      const tmp = makeTempDir();
      try {
        const result = await buildBundle({
          repoRoot: ROOT,
          outputDir: tmp,
          dryRun: false,
          bundleName: "verify-paths.zip",
        });

        const zipData = readFileSync(result.outputPath!);
        const zip = await JSZip.loadAsync(zipData);

        // Verify key files are in the zip with correct relative paths
        expect(zip.file("runtime/github/runtime-manifest.json")).not.toBeNull();
        expect(zip.file(".GITHUB-MODE-ACTIVE.md")).not.toBeNull();
        expect(zip.file(".GITHUB-MODE-README.md")).not.toBeNull();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("zip contains valid JSON contracts", async () => {
      const tmp = makeTempDir();
      try {
        const result = await buildBundle({
          repoRoot: ROOT,
          outputDir: tmp,
          dryRun: false,
          bundleName: "verify-content.zip",
        });

        const zipData = readFileSync(result.outputPath!);
        const zip = await JSZip.loadAsync(zipData);

        const manifestFile = zip.file("runtime/github/runtime-manifest.json");
        expect(manifestFile).not.toBeNull();

        const content = await manifestFile!.async("string");
        const manifest = JSON.parse(content);
        expect(manifest.schemaVersion).toBe("1.0");
        expect(manifest.components).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("uses timestamped name by default", async () => {
      const tmp = makeTempDir();
      try {
        const result = await buildBundle({
          repoRoot: ROOT,
          outputDir: tmp,
          dryRun: false,
        });

        expect(result.outputPath).toMatch(/gitclaw-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("dry run does not create a file", async () => {
      const tmp = makeTempDir();
      try {
        const result = await buildBundle({
          repoRoot: ROOT,
          outputDir: tmp,
          dryRun: true,
        });

        expect(result.outputPath).toBeUndefined();
        expect(result.fileCount).toBeGreaterThan(10);
        expect(result.sizeBytes).toBe(0);

        // No zip file should exist
        const files = require("node:fs").readdirSync(tmp);
        expect(files.filter((f: string) => f.endsWith(".zip"))).toHaveLength(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("parseArgs", () => {
    it("parses with no arguments (defaults)", () => {
      const result = parseArgs(["node", "script.ts"]);
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.repoRoot).toBe(ROOT);
        expect(result.outputDir).toBe(ROOT);
        expect(result.dryRun).toBe(false);
      }
    });

    it("parses --dry-run flag", () => {
      const result = parseArgs(["node", "script.ts", "--dry-run"]);
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.dryRun).toBe(true);
      }
    });

    it("parses --output-dir flag", () => {
      const result = parseArgs(["node", "script.ts", "--output-dir", ROOT]);
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.outputDir).toBe(ROOT);
      }
    });

    it("returns error for missing --output-dir value", () => {
      const result = parseArgs(["node", "script.ts", "--output-dir"]);
      expect("error" in result).toBe(true);
    });

    it("returns error for nonexistent output dir", () => {
      const result = parseArgs(["node", "script.ts", "--output-dir", "/nonexistent/path"]);
      expect("error" in result).toBe(true);
    });

    it("returns help text for --help", () => {
      const result = parseArgs(["node", "script.ts", "--help"]);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("Usage:");
        expect(result.error).toContain("unzip");
      }
    });

    it("accepts positional arg as output dir", () => {
      const result = parseArgs(["node", "script.ts", ROOT]);
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.outputDir).toBe(ROOT);
      }
    });
  });
});
