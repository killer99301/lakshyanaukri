#!/bin/sh
# Vercel "Ignored Build Step" (vercel.json → ignoreCommand).
#   exit 1 → build and deploy
#   exit 0 → skip this deployment
#
# Builds when anything that affects the site has changed since the last
# SUCCESSFUL deployment. Comparing only the last commit with the one before it
# is not enough: a push of several commits whose last one touches only tests
# would be skipped, leaving the earlier code changes undeployed.
#
# When the last deployed commit is unknown or not in this checkout, build.

BASE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}"

git cat-file -e "$BASE^{commit}" 2>/dev/null || exit 1

if git diff "$BASE" HEAD --name-only | grep -qE '^(src/|scripts/validate\.ts|scripts/vercel-ignore\.sh|next\.config\.|package(-lock)?\.json|vercel\.json|tsconfig\.json|postcss\.config\.|public/)'; then
  exit 1
fi
exit 0
