# GitHub Mode Usage Guide

This guide explains how to use OpenClaw's GitHub Mode to run AI agents directly from GitHub repositories via GitHub Actions.

## Overview

GitHub Mode enables you to trigger OpenClaw agents through GitHub events without needing to run OpenClaw locally. The agents execute in GitHub Actions runners and can:

- Analyze and explain code
- Suggest and implement refactorings
- Generate tests
- Create architectural diagrams
- Review pull requests

## Quick Start

### 1. Manual Workflow Dispatch

The simplest way to try GitHub Mode:

1. Go to **Actions** tab in your repository
2. Select **GitHub Mode Command** workflow
3. Click **Run workflow**
4. Fill in:
   - **Command**: Choose from `explain`, `refactor`, `test`, or `diagram`
   - **Target**: Enter a file path (e.g., `src/agent.ts`)
   - **Open bot PR**: Check this to create a PR with any changes
5. Click **Run workflow**

The agent will execute and you can view the output in:
- Workflow summary (last 100 lines)
- Artifacts (full agent log)
- Pull request (if changes were made and bot PR enabled)

### 2. Issue Commands

Comment on any issue with OpenClaw commands:

```
/openclaw explain src/commands/agent.ts
```

**Supported commands:**
- `/openclaw explain <file>` - Get explanation of a file
- `/openclaw refactor <file>` - Get refactoring suggestions
- `/openclaw test <file>` - Generate tests
- `/openclaw diagram <file>` - Create architectural diagram

The workflow will:
1. React with 🚀 emoji to acknowledge
2. Execute the agent
3. Post results in workflow artifacts

### 3. PR Commands

Comment on pull requests to trigger analysis:

```
/openclaw review
```

This analyzes all changes in the PR. You can also target specific files:

```
/openclaw test src/newfile.ts
```

**Supported commands:**
- `/openclaw review` - Analyze all PR changes
- `/openclaw explain <file>` - Explain specific file
- `/openclaw refactor <file>` - Suggest improvements
- `/openclaw test <file>` - Generate tests

When a PR command creates changes, a bot branch and PR are automatically created.

### 4. Auto-Analysis via Labels

Add the `openclaw` label to any issue to trigger automatic analysis:

1. Create or open an issue
2. Add label: `openclaw`
3. Workflow automatically triggers
4. Results appear in workflow artifacts

## How It Works

### Architecture

```
GitHub Event → Parse Command → Security Gates → Execute Agent → Create Bot PR
```

**Workflow Files:**
- `.github/workflows/github-mode-command.yml` - Main command orchestration
- `.github/workflows/github-mode-agent-run.yml` - Agent execution
- `.github/workflows/github-mode-bot-pr.yml` - PR creation
- `.github/workflows/github-mode-issue-comment.yml` - Issue comment trigger
- `.github/workflows/github-mode-pr-comment.yml` - PR comment trigger
- `.github/workflows/github-mode-issue-opened.yml` - Issue label trigger

### Security Gates

Every workflow run goes through multiple security checks:

1. **GitHub Mode Activation Check** - Ensures `.GITHUB-MODE/ACTIVE.md` exists
2. **Pre-agent Gates** - Validates command, context, and policies
3. **Trust Authorization** - Checks user permissions
4. **Policy Gates** - Enforces runtime policies
5. **Provenance Validation** - Tracks execution metadata

All gates must pass before the agent executes.

### Agent Execution

The agent runs using the OpenClaw CLI:

```bash
pnpm openclaw agent --message "<generated message>" --thinking high
```

Messages are constructed based on the command type and target file.

### Output and Artifacts

Each workflow run produces:

1. **Workflow Summary** - Last 100 lines of agent output
2. **Artifacts:**
   - `github-mode-command-output/` - Full agent logs
   - `github-mode-command-dispatch-evidence/` - Execution metadata
   - Gate evidence artifacts
3. **Bot Branch & PR** (if changes made and requested)

## Configuration

### Required Secrets

None! GitHub Mode uses the built-in `GITHUB_TOKEN` for repository operations.

### Required Permissions

The workflows need these permissions (already configured):

- `contents: write` - For creating branches
- `pull-requests: write` - For creating PRs
- `issues: read` - For reading issue/comment content

### Activation Control

GitHub Mode is controlled by the presence of `.GITHUB-MODE/ACTIVE.md`:

- **Exists**: Workflows run normally
- **Missing/Renamed**: All workflows fail immediately with clear message

To disable GitHub Mode temporarily:
```bash
mv .GITHUB-MODE/ACTIVE.md .GITHUB-MODE/ACTIVE.md.disabled
```

To re-enable:
```bash
mv .GITHUB-MODE/ACTIVE.md.disabled .GITHUB-MODE/ACTIVE.md
```

## Troubleshooting

### Workflow Doesn't Trigger

**Issue comment/PR comment not working:**
- Ensure comment starts with `/openclaw ` (with space)
- Check that command is one of: explain, refactor, test, diagram, review
- Verify `.GITHUB-MODE/ACTIVE.md` exists

**Issue label not working:**
- Label must be exactly `openclaw` (lowercase)
- Workflow only triggers on `opened` or `labeled` events

### Agent Execution Fails

Check the workflow logs:

1. Go to **Actions** tab
2. Click on the failed workflow run
3. Expand the **Execute command** or **Execute agent** step

Common issues:
- Dependencies not installed (check setup-node-env action)
- OpenClaw CLI not built (should auto-build via pnpm openclaw)
- Invalid file path in target

### No Bot PR Created

Bot PRs are only created when:
1. `open_bot_pr` input is `true`
2. Agent made file changes
3. Security gates all passed

Check workflow summary for the output of "Check for file changes" step.

### Security Gate Failures

If a security gate fails:
1. Check the uploaded gate evidence artifacts
2. Review the gate summary in workflow output
3. Ensure your command and target are within policy bounds

Gates are fail-closed: any failure blocks execution.

## Advanced Usage

### Custom Commands

To add new commands, modify:

1. Workflow inputs (add to `options` in `.github/workflows/github-mode-command.yml`)
2. Command parsing logic in trigger workflows
3. Message generation in the agent execution step

### Integration with Other Workflows

GitHub Mode workflows can be called from other workflows using `workflow_call`:

```yaml
jobs:
  run-agent:
    uses: ./.github/workflows/github-mode-command.yml
    with:
      command: refactor
      target: src/myfile.ts
      open_bot_pr: true
```

### Customizing Agent Behavior

Edit the "Execute command" step in `.github/workflows/github-mode-command.yml`:

- Add CLI flags: `--thinking low`, `--verbose`, etc.
- Modify message templates for each command type
- Add environment variables for OpenClaw configuration

## Best Practices

1. **Start Simple** - Try manual dispatch first, then issue commands
2. **Review Artifacts** - Always check workflow artifacts for full context
3. **Use Bot PRs** - Enable `open_bot_pr` for refactor/test commands
4. **Monitor Costs** - Each agent run uses GitHub Actions minutes
5. **Security First** - Review bot PR changes before merging

## Limits and Considerations

- **Stateless Execution** - Each run starts fresh; no memory between runs
- **GitHub Actions Quotas** - Subject to your repo's Actions limits
- **No Interactive Sessions** - Agent runs are one-shot; no back-and-forth
- **Public Repos** - Be mindful of exposing info in public workflow logs

## Support

- Issues: Use the `openclaw` label for auto-triage
- Docs: https://docs.openclaw.ai
- Community: https://discord.gg/clawd

## See Also

- [GitHub Mode Architecture](docs/overview.md)
- [Security Model](docs/security/README.md)
- [Runtime Contracts](runtime/README.md)
- [Implementation Plan](docs/planning/implementation-plan.md)
