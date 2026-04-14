#!/bin/sh
# LexLens secret detection script.
# Usage: run manually, or install as a git pre-commit hook:
#   cp scripts/check-secrets.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Blocks commits containing known secret patterns.
# Patterns: Anthropic API keys (sk-ant-)

PATTERNS="sk-ant-"

# If run as pre-commit hook, check staged files.
# If run manually, check all tracked files.
if [ -n "$GIT_INDEX_FILE" ] || git diff --cached --quiet 2>/dev/null; then
  FILES=$(git diff --cached --name-only 2>/dev/null)
  MODE="staged"
else
  FILES=$(git ls-files 2>/dev/null)
  MODE="all tracked"
fi

FOUND=0

for file in $FILES; do
  if [ ! -f "$file" ]; then
    continue
  fi
  for pattern in $PATTERNS; do
    if grep -q "$pattern" "$file" 2>/dev/null; then
      echo "SECRET DETECTED in $file (pattern: $pattern)"
      FOUND=1
    fi
  done
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "BLOCKED: Secret pattern found. Remove all credential values and use env var references instead."
  echo "See SECURITY.md for the credential management policy."
  exit 1
fi

echo "check-secrets: no secret patterns found in $MODE files."
exit 0
