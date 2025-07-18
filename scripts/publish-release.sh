#!/bin/bash

# Publish Release Script for GitLab Component Helper
# This script pushes commits, tags, and creates a GitHub release with the .vsix file

set -e # Exit on any error

echo "📤 Starting release publish process..."
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ Not in a git repository"
  exit 1
fi

# Check if there are any unpushed commits or tags
UNPUSHED_COMMITS=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
UNPUSHED_TAGS=$(git tag --merged HEAD | while read tag; do git ls-remote origin refs/tags/$tag >/dev/null 2>&1 || echo $tag; done | wc -l | tr -d ' ')

if [ "$UNPUSHED_COMMITS" = "0" ] && [ "$UNPUSHED_TAGS" = "0" ]; then
  echo "ℹ️  No unpushed commits or tags found. Nothing to publish."
  echo "   Run a release script first: npm run release:manual or npm run release:local"
  exit 0
fi

echo "📋 Found $UNPUSHED_COMMITS unpushed commit(s) and $UNPUSHED_TAGS unpushed tag(s)"

# Get the latest local tag
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$LATEST_TAG" ]; then
  echo "❌ No tags found. Run a release script first."
  exit 1
fi

echo "🏷️  Latest tag: $LATEST_TAG"

# Check if .vsix file exists for this version
VERSION=${LATEST_TAG#v} # Remove 'v' prefix
VSIX_FILES=$(ls gitlab-component-helper-*.vsix 2>/dev/null || echo "")
if [ -z "$VSIX_FILES" ]; then
  echo "❌ No .vsix files found. Run 'npm run package' to build the extension."
  exit 1
fi

# Find the most recent .vsix file
LATEST_VSIX=$(ls -t gitlab-component-helper-*.vsix | head -n1)
echo "📦 Found extension package: $LATEST_VSIX"

# Check if GitHub CLI is available
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ GitHub CLI (gh) is not installed."
  echo "   Install it with: brew install gh"
  echo "   Or download from: https://cli.github.com/"
  exit 1
fi

# Check if user is authenticated with GitHub CLI
if ! gh auth status >/dev/null 2>&1; then
  echo "❌ Not authenticated with GitHub CLI."
  echo "   Run: gh auth login"
  exit 1
fi

echo "✅ GitHub CLI is installed and authenticated"
echo ""

# Ask for confirmation
echo "🤔 Ready to publish release. This will:"
echo "   - Push commits to origin/main"
echo "   - Push tag $LATEST_TAG to origin"
echo "   - Create GitHub release $LATEST_TAG"
echo "   - Upload $LATEST_VSIX to the release"
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Publish cancelled"
  exit 0
fi

# Push commits
if [ "$UNPUSHED_COMMITS" -gt "0" ]; then
  echo "📋 Pushing commits to origin/main..."
  git push origin main
  echo "✅ Commits pushed"
else
  echo "ℹ️  No commits to push"
fi

# Push tags
if [ "$UNPUSHED_TAGS" -gt "0" ]; then
  echo "📋 Pushing tag $LATEST_TAG to origin..."
  git push origin "$LATEST_TAG"
  echo "✅ Tag pushed"
else
  echo "ℹ️  Tag already exists on remote"
fi

# Check if release already exists
if gh release view "$LATEST_TAG" >/dev/null 2>&1; then
  echo "⚠️  Release $LATEST_TAG already exists on GitHub"
  read -p "Update existing release? (y/N): " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📋 Uploading $LATEST_VSIX to existing release..."
    gh release upload "$LATEST_TAG" "$LATEST_VSIX" --clobber
    echo "✅ Extension package uploaded to existing release"
  else
    echo "ℹ️  Skipping release update"
  fi
else
  # Create new GitHub release
  echo "📋 Creating GitHub release $LATEST_TAG..."

  # Generate release notes from tag or CHANGELOG
  RELEASE_NOTES=""
  if [ -f "CHANGELOG.md" ]; then
    # Extract release notes from CHANGELOG.md
    RELEASE_NOTES=$(awk "/^## \[$VERSION\]/{flag=1; next} /^## \[/{flag=0} flag" CHANGELOG.md 2>/dev/null || echo "")
  fi

  if [ -z "$RELEASE_NOTES" ]; then
    # Fallback to commits since previous tag
    PREV_TAG=$(git describe --tags --abbrev=0 "$LATEST_TAG^" 2>/dev/null || echo "")
    if [ -n "$PREV_TAG" ]; then
      RELEASE_NOTES=$(git log "$PREV_TAG..$LATEST_TAG" --pretty=format:"- %s" 2>/dev/null || echo "")
    else
      RELEASE_NOTES="Release $LATEST_TAG"
    fi
  fi

  # Create the release
  if [ -n "$RELEASE_NOTES" ]; then
    echo "$RELEASE_NOTES" | gh release create "$LATEST_TAG" "$LATEST_VSIX" \
      --title "$LATEST_TAG" \
      --notes-file -
  else
    gh release create "$LATEST_TAG" "$LATEST_VSIX" \
      --title "$LATEST_TAG" \
      --generate-notes
  fi

  echo "✅ GitHub release created with extension package"
fi

echo ""
echo "🎉 Release published successfully!"
echo "🔗 View release: https://github.com/eFAILution/gitlab-component-helper/releases/tag/$LATEST_TAG"
echo "📦 Extension package: $LATEST_VSIX"
echo ""
echo "💡 Users can now install the extension from:"
echo "   - VS Code Marketplace (if published)"
echo "   - Direct download from GitHub releases"
echo "   - Command: code --install-extension $LATEST_VSIX"
