#!/usr/bin/env bash
set -euo pipefail

BASELINE_FILE=".github/baselines/installed-runtime-smoke.json"

if [ ! -f "$BASELINE_FILE" ]; then
  echo "::error::Missing baseline file: $BASELINE_FILE"
  exit 1
fi

printf '::group::Read installed runtime baseline\n'
EXPECTED_VERSION=$(node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(data.expectedVersionPrefix);" "$BASELINE_FILE")
EXPECTED_HELP=$(node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for (const token of data.helpTokens){console.log(token);}" "$BASELINE_FILE")
REQUIRED_TARBALL_ENTRIES=$(node -e "const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for (const entry of data.requiredTarballEntries){console.log(entry);}" "$BASELINE_FILE")
printf 'Baseline version prefix: %s\n' "$EXPECTED_VERSION"
printf 'Baseline help tokens:\n%s\n' "$EXPECTED_HELP"
printf 'Baseline tarball entries:\n%s\n' "$REQUIRED_TARBALL_ENTRIES"
printf '::endgroup::\n'

printf '::group::Build distributable package\n'
pnpm install --ignore-scripts --frozen-lockfile
pnpm build
PACK_FILE=$(pnpm pack --pack-destination /tmp | awk '/^\/tmp\/.*\.tgz$/ { value=$0 } END { print value }')
if [ -z "$PACK_FILE" ]; then
  echo "::error::Unable to locate packed tarball path from pnpm pack output."
  exit 1
fi
printf 'Packed archive: %s\n' "$PACK_FILE"

PACK_CONTENTS=$(tar -tzf "$PACK_FILE")
while IFS= read -r required_entry; do
  [ -z "$required_entry" ] && continue
  if ! grep -Fqx "$required_entry" <<<"$PACK_CONTENTS"; then
    echo "::error::Packed archive missing required entry '$required_entry'."
    exit 1
  fi
done <<< "$REQUIRED_TARBALL_ENTRIES"

EXTRACT_DIR=$(mktemp -d)
trap 'rm -rf "$EXTRACT_DIR"' EXIT
tar -xzf "$PACK_FILE" -C "$EXTRACT_DIR"

PACKAGED_CLI_ROOT="$EXTRACT_DIR/package"
if [ ! -f "$PACKAGED_CLI_ROOT/openclaw.mjs" ]; then
  echo "::error::Packaged CLI entrypoint missing: $PACKAGED_CLI_ROOT/openclaw.mjs"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "::error::Workspace node_modules is missing. Run pnpm install before smoke checks."
  exit 1
fi

# Execute packaged CLI with workspace dependencies so the check validates packaged
# entrypoints/outputs without requiring registry access in restricted environments.
ln -s "$(pwd)/node_modules" "$PACKAGED_CLI_ROOT/node_modules"

ACTUAL_VERSION=$(cd "$PACKAGED_CLI_ROOT" && node openclaw.mjs --version | tr -d '\r')
ACTUAL_HELP=$(cd "$PACKAGED_CLI_ROOT" && node openclaw.mjs --help | tr -d '\r')
printf 'Packaged CLI version: %s\n' "$ACTUAL_VERSION"
printf '::endgroup::\n'

if [[ "$ACTUAL_VERSION" != "$EXPECTED_VERSION"* ]]; then
  echo "::error::Installed runtime version baseline mismatch. Expected prefix '$EXPECTED_VERSION', got '$ACTUAL_VERSION'."
  exit 1
fi

while IFS= read -r token; do
  [ -z "$token" ] && continue
  if ! grep -Fq "$token" <<<"$ACTUAL_HELP"; then
    echo "::error::Installed runtime help baseline missing token '$token'."
    exit 1
  fi
done <<< "$EXPECTED_HELP"

echo "Installed runtime smoke baseline passed."
