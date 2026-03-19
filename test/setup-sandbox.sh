#!/bin/bash
# Setup test sandbox: bare remote + cloned workspace
# This must be run before e2e-runner, deep-audit, extended-audit, design-features, final-audit

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE="$SCRIPT_DIR/remote.git"
SANDBOX="$SCRIPT_DIR/sandbox"

# Clean up previous sandbox
rm -rf "$REMOTE" "$SANDBOX"

# Create bare remote
git init --bare "$REMOTE" 2>/dev/null

# Clone and init sandbox
git clone "$REMOTE" "$SANDBOX" 2>/dev/null
cd "$SANDBOX"
echo "# Test Sandbox" > README.md
git add README.md
git commit -m "init sandbox" 2>/dev/null
git push 2>/dev/null

echo "✅ Test sandbox ready at $SANDBOX"
echo "   Remote: $REMOTE"
