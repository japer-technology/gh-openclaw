# GitHub Mode Fork Installation Guide

This guide explains how to install GitHub Mode components into an existing fork of the OpenClaw repository using a distributable zip bundle.

---

## Overview

GitHub Mode is an additive runtime layer that shifts OpenClaw orchestration to GitHub Actions workflows while preserving the installed runtime. To use GitHub Mode in your own fork, you extract a zip bundle containing all required components.

### Component groups

The bundle contains six component groups:

| Group                  | Directory / Files                                                         | Purpose                                                                            |
| ---------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Runtime Contracts      | `runtime/github/`                                                         | Machine-readable contracts, schemas, and policies that define GitHub Mode behavior |
| Workflows              | `.github/workflows/github-mode-*.yml`                                     | GitHub Actions workflows for validation, commands, and policy enforcement          |
| Documentation          | `docs/github-mode/`                                                       | Architecture docs, ADRs, security analysis, and planning guides                    |
| Validation Scripts     | `scripts/validate-*.ts`, `scripts/check-*.ts`, `scripts/build-*.ts`       | Contract validation, upstream-additive guard, and bundle builder scripts           |
| Tests                  | `test/validate-*.test.ts`, `test/check-*.test.ts`, `test/build-*.test.ts` | Test suites for contract validation and guards                                     |
| Repository Entrypoints | `.GITHUB-MODE-ACTIVE.md`, `.GITHUB-MODE-README.md`                        | Top-level fork orientation files                                                   |

---

## Prerequisites

- **Node.js 22+** installed
- **pnpm** package manager installed
- A **local clone of your OpenClaw fork**

---

## Building the bundle

From the upstream OpenClaw repository root, generate a timestamped zip:

```bash
pnpm github-mode:bundle
```

This creates a file like `gitclaw-2026-02-17-20-15.zip` in the repo root.

### Options

```bash
# Build to a specific directory
pnpm github-mode:bundle --output-dir /path/to/output

# Preview what would be bundled without creating the zip
pnpm github-mode:bundle --dry-run
```

---

## Installing into your fork

### Fresh install

Extract the zip into your fork's root directory:

```bash
unzip -o gitclaw-2026-02-17-20-15.zip -d /path/to/your/fork
```

### Updating

To update an existing GitHub Mode installation, extract the latest bundle with overwrite:

```bash
unzip -o gitclaw-2026-02-17-20-15.zip -d /path/to/your/fork
```

The `-o` flag overwrites existing files, updating contracts, workflows, docs, and scripts to the latest version.

---

## Post-installation steps

After extracting the bundle:

### 1. Install dependencies

```bash
cd /path/to/your/fork
pnpm install
```

### 2. Validate contracts

```bash
pnpm contracts:github:validate
```

This runs the contract validation script against all `runtime/github/` artifacts. All checks must pass.

### 3. Run tests

```bash
pnpm test -- test/validate-github-runtime-contracts.test.ts test/check-upstream-additions-only.test.ts
```

### 4. Add the npm script (if not present)

Ensure your fork's `package.json` includes the validation script:

```json
{
  "scripts": {
    "contracts:github:validate": "node --import tsx scripts/validate-github-runtime-contracts.ts"
  }
}
```

### 5. Commit and push

```bash
git add -A
git commit -m "chore: install GitHub Mode components"
git push
```

### 6. Enable GitHub Actions

Ensure GitHub Actions are enabled in your fork's repository settings. The `github-mode-contracts.yml` workflow will automatically validate contracts on PRs that touch GitHub Mode paths.

---

## Component dependency graph

Some components depend on others. The minimum viable installation order is:

```
runtime/github/          (required — contracts define all behavior)
    ↓
scripts/validate-*.ts    (required — validates contracts in CI)
    ↓
.github/workflows/       (required — enforces validation in CI)
    ↓
test/                    (recommended — validates contract logic)
    ↓
docs/github-mode/        (recommended — architecture and planning)
    ↓
.GITHUB-MODE-*.md        (optional — repository orientation)
```

---

## Security considerations

### Fork PR safety

GitHub Mode workflows are designed so that fork PRs run safely with no secret access. The `trust-levels.json` contract defines three trust tiers:

- **Untrusted**: fork PRs and unknown actors get read-only, constrained capabilities
- **Semi-trusted**: internal PRs with moderate capabilities but no secret access
- **Trusted**: maintainer-approved environments with full secret and mutation access

### Upstream sync safety

The `scripts/check-upstream-additions-only.ts` guard ensures that GitHub Mode changes are purely additive. This means your fork can safely pull upstream updates without merge conflicts in core OpenClaw files.

### Secret management

GitHub Mode never stores secrets in the repository. All secrets must be configured via GitHub repository Settings > Secrets and variables > Actions.

---

## Customizing GitHub Mode for your fork

### Entity identity

Edit `runtime/github/entity-manifest.json` to set your fork's entity identity:

```json
{
  "schemaVersion": "1.0",
  "entityId": "your-entity-id",
  "owner": "@your-org/your-team",
  "trustTier": "trusted",
  "capabilities": ["validate", "command", "agent-run", "bot-pr"]
}
```

### Command policy

Edit `runtime/github/command-policy.json` to customize allowed actions:

```json
{
  "schemaVersion": "1.0",
  "policyVersion": "v1.0.0",
  "enforcementMode": "enforce",
  "allowedActions": ["plan", "validate", "open-pr"],
  "constraints": ["No direct protected-branch mutation outside pull-request flow."]
}
```

### Collaboration policy

Edit `runtime/github/collaboration-policy.json` to configure cross-entity collaboration routes (deny-by-default).

---

## Troubleshooting

### Contract validation fails

If `pnpm contracts:github:validate` fails after installation:

1. Check that all `runtime/github/` files were extracted correctly.
2. Verify JSON syntax in all contract files.
3. Ensure `parity-matrix.json` entries marked `installed-only` have `owner` and `rationale` fields.
4. Run with verbose output: `node --import tsx scripts/validate-github-runtime-contracts.ts`

### Workflow does not trigger

If the `github-mode-contracts.yml` workflow does not run on PRs:

1. Ensure GitHub Actions are enabled for your fork.
2. Check that the PR modifies files matching the workflow's `paths` filter.
3. Verify the workflow file is in `.github/workflows/`.

---

## Related documents

- [GitHub Mode Overview](overview.md)
- [MVP Plan](planning/mvp.md)
- [Implementation Plan](planning/implementation-plan.md)
- [Implementation Tasks](planning/implementation-tasks.md)
- [ADR 0001: Runtime Boundary](adr/0001-runtime-boundary-and-ownership.md)
- [ADR 0002: Non-Regression Guardrails](adr/0002-installed-runtime-non-regression-guardrails.md)
- [Trigger Trust Matrix](security/0001-github-trigger-trust-matrix.md)
- [Runtime Contracts README](../../runtime/github/README.md)
