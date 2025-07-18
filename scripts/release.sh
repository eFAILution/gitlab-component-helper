#!/bin/bash

# Local Release Script for GitLab Component Helper
# This script runs semantic-release locally to avoid GitHub Actions costs

set -e # Exit on any error

echo "🚀 Starting local release process..."
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ Not in a git repository"
  exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working directory is not clean. Please commit your changes first."
  echo "Uncommitted changes:"
  git status --porcelain
  exit 1
fi

echo "✅ Working directory is clean"
echo ""

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "⚠️  You're on branch '$CURRENT_BRANCH'. Releases should be made from 'main' branch."
  echo "Continuing with current branch..."
  echo ""
fi

# Run tests
echo "📋 Running tests..."
npm run test
echo "✅ Tests completed"
echo ""

# Build and package
echo "📋 Building and packaging extension..."
npm run package
echo "✅ Build and package completed"
echo ""

# Check if we should create a GitHub release
if [ -z "$GITHUB_TOKEN" ]; then
  echo "ℹ️  No GITHUB_TOKEN found. Release will be created locally only."
  echo "   To create GitHub releases, set GITHUB_TOKEN environment variable."
  echo ""
fi

# Run semantic release
echo "📋 Running manual release (bypasses GitHub token requirement)..."
npm run release:manual
echo ""

echo "🎉 Release completed successfully!"
echo "📝 Check CHANGELOG.md for the updated changelog"
echo "🏷️  New git tag has been created"
echo "📦 Extension package (.vsix) is ready"
if [ -n "$GITHUB_TOKEN" ]; then
  echo "🚀 GitHub release created"
else
  echo "ℹ️  GitHub release not created (no token)"
fi
