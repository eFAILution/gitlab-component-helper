#!/bin/bash

# Complete Release and Publish Script for GitLab Component Helper
# This script runs a local release and then publishes it to GitHub

set -e # Exit on any error

echo "🚀 Complete Release & Publish Process"
echo "======================================"
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ Not in a git repository"
  exit 1
fi

# Ask which release method to use
echo "Choose release method:"
echo "1) Manual release (recommended, zero dependencies)"
echo "2) Semantic release (local)"
echo ""
read -p "Enter choice (1 or 2): " -n 1 -r
echo ""

case $REPLY in
1)
  echo "📋 Running manual release..."
  npm run release:manual
  ;;
2)
  echo "📋 Running semantic release..."
  npm run release:local
  ;;
*)
  echo "❌ Invalid choice. Exiting."
  exit 1
  ;;
esac

echo ""
echo "🎯 Release completed! Now publishing..."
echo ""

# Run the publish script
./scripts/publish-release.sh

echo ""
echo "🎉 Complete release and publish process finished!"
echo "🔗 Your extension is now available on GitHub releases"
