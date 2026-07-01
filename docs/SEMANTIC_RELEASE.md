# Local Release Setup - Zero GitHub Actions Cost! 💰

This project supports multiple release strategies, all designed to avoid GitHub Actions costs while maintaining professional release workflows.

## ⚠️ Important: GitHub Token Issue with Semantic-Release

**Semantic-release always requires a GitHub token**, even for local-only releases, because it automatically loads the GitHub plugin. For truly token-free releases, use the manual release script.

## 🎯 Recommended: Manual Release Script (No Token Required)

**The best option for local releases without any GitHub token dependency:**

```bash
npm run release:manual
```

**What it does:**
- ✅ **Zero GitHub token required**
- ✅ Analyzes conventional commits automatically
- ✅ Bumps version based on commit types (major/minor/patch)
- ✅ Runs tests before releasing
- ✅ Builds and packages extension
- ✅ Updates package.json version
- ✅ Generates/updates CHANGELOG.md with categorized changes
- ✅ Creates git tag
- ✅ Commits changes with proper message
- 💰 **Zero GitHub Actions cost**
- 🔒 **No external dependencies or tokens**

## 🔍 Test Before Release (Dry Run)

**Want to see what would happen without making any changes?**

```bash
npm run release:dry
```

**What it shows:**
- ✅ **Zero changes made to your files**
- ✅ Shows version bump that would happen
- ✅ Displays changelog entries that would be added
- ✅ Lists git commands that would run
- ✅ Perfect for testing your conventional commits
- 🔒 **Completely safe - no modifications**

## 🔄 One-Command Complete Release

**The easiest way - does everything for you:**

```bash
npm run release:complete
```

**What it does:**
- ✅ Runs manual release (no token needed)
- ✅ Pushes commits and tags to GitHub
- ✅ Creates GitHub release with .vsix file attached
- 💰 **Zero GitHub Actions cost**
- 🔧 **Requires GitHub CLI for the publish step only**

## 📋 Quick Reference

| Command | What it does | GitHub Token | GitHub CLI | Cost |
|---------|-------------|-------------|-----------|------|
| `npm run release:manual` | **✅ RECOMMENDED** - Complete local release | ❌ Not needed | ❌ Not needed | 💰 FREE |
| `npm run release:complete` | Manual release + GitHub publish | ❌ Not needed | ✅ Required | 💰 FREE |
| `npm run release:publish` | Publish existing release | ❌ Not needed | ✅ Required | 💰 FREE |
| `npm run release:dry` | **🔍 DRY RUN** - Shows what manual release would do | ❌ Not needed | ❌ Not needed | 💰 FREE |
| `npm run semantic-release:env-dry` | **🔍 TEST** - Verify .env token works | ✅ From .env | ❌ Not needed | 💰 FREE |
| `npm run semantic-release:env-only-dry` | **🔍 TEST** - Verify .env token works (local-only) | ✅ From .env | ❌ Not needed | 💰 FREE |
| `npm run semantic-release:env` | **🔑 Semantic-release** with .env token | ✅ From .env | ❌ Not needed | 💰 FREE |
| `npm run semantic-release:env-only` | **🔑 Semantic-release** local-only with .env token | ✅ From .env | ❌ Not needed | 💰 FREE |

## 🚫 Semantic-Release Local Commands (Token Required)

These commands require a GitHub token due to semantic-release limitations:

```bash
# ⚠️ These require GITHUB_TOKEN to be set
npm run semantic-release:local
npm run semantic-release:local-only
```

**Why?** Semantic-release automatically loads the GitHub plugin even when not explicitly configured, making it impossible to run truly local-only without a token.

## 🔑 Using Semantic-Release with .env Token (Optional)

**If you want to use semantic-release instead of the manual script:**

### Quick Setup
```bash
npm run setup:github-token
```
This will guide you through the token setup process.

### Manual Setup
1. **Create a GitHub Personal Access Token:**
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `repo` (full control of private repositories)
   - Copy the token

2. **Create .env file:** (already gitignored)
   ```bash
   cp .env.example .env
   # Edit .env and add your token:
   GITHUB_TOKEN=ghp_your_token_here
   ```

3. **Test your setup (dry run):**
   ```bash
   # Test if token works (no changes made)
   npm run semantic-release:env-dry

   # Test local-only version (no changes made)
   npm run semantic-release:env-only-dry
   ```

4. **Use semantic-release commands:**
   ```bash
   # Semantic-release with .env token
   npm run semantic-release:env

   # Semantic-release local-only with .env token
   npm run semantic-release:env-only
   ```

**These commands will:**
- ✅ Load GitHub token from `.env` file
- ✅ Run semantic-release with full GitHub integration
- ✅ Create releases, tags, and upload assets
- ✅ Work exactly like semantic-release should
- 🔒 Keep your token secure and gitignored

## 🛠️ Prerequisites for Publishing

To use the publish functionality, you need GitHub CLI:

```bash
# Install GitHub CLI
brew install gh  # macOS
# or download from https://cli.github.com/

# Authenticate
gh auth login
```

## 🎯 Conventional Commits

Use these commit formats to trigger automatic releases:

```bash
# Patch release (1.0.0 → 1.0.1)
git commit -m "fix: resolve component detection issue"

# Minor release (1.0.0 → 1.1.0)
git commit -m "feat: add new hover provider functionality"

# Major release (1.0.0 → 2.0.0)
git commit -m "feat!: redesign API with breaking changes"

# No release (documentation, refactoring, etc.)
git commit -m "docs: update README with examples"
git commit -m "refactor: improve code structure"
git commit -m "chore: update dependencies"
```

## 🎯 Typical Workflow (Token-Free)

1. **Code your changes**
2. **Commit with conventional format:** `git commit -m "feat: add awesome feature"`
3. **Create release locally:** `npm run release:manual`
4. **Publish to GitHub:** `npm run release:publish` (requires GitHub CLI)
5. **Done!** 🎉 Your extension is available on GitHub releases

## 🛠️ What Gets Updated

All release methods update:
- ✅ `package.json` version
- ✅ `package-lock.json` to match new version
- ✅ `CHANGELOG.md` with categorized changes
- ✅ Git tag (e.g., `1.2.3`)
- ✅ Packaged `.vsix` extension file
- ✅ GitHub release (if using publish scripts)

## 📦 Extension Distribution

After publishing, users can install your extension:
- **Direct download:** From GitHub releases page
- **Command line:** `code --install-extension gitlab-component-helper-1.2.3.vsix`
- **VS Code:** Extensions → Install from VSIX

## 💡 Pro Tip

The manual release script (`npm run release:manual`) is actually **more reliable** than semantic-release for local use because:
- ✅ No external dependencies
- ✅ No token requirements
- ✅ Complete control over the process
- ✅ Same conventional commit analysis
- ✅ Better error handling
