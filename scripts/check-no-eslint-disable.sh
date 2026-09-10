#!/bin/bash
# Surakshak absolute rule: no eslint-disable / ts-ignore comments anywhere in src/.
# Suppressing a lint or type error hides a real problem; fix the code instead.

FOUND=$(grep -rnE "eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck" \
  --include="*.ts" src/ 2>/dev/null)

if [ -n "$FOUND" ]; then
  echo ""
  echo "❌ ERROR: eslint-disable / ts-ignore comments are NOT allowed in src/."
  echo "   Fix the actual issue instead of suppressing it."
  echo ""
  echo "$FOUND"
  echo ""
  exit 1
fi

echo "✅ No eslint-disable / ts-ignore comments found in src/"
exit 0
