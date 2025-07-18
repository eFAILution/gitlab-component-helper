# GitHub Copilot Conventional Commits Guide

This project is configured to use Angular-style conventional commits with GitHub Copilot.

## 🤖 Copilot Configuration

The following settings have been configured in `.vscode/settings.json`:

- **Convention**: Angular conventional commits
- **Max Length**: 100 characters for the first line
- **Template**: Structured format with type, scope, description, body, and footer

## 🎯 Using Copilot for Commit Messages

### Method 1: Copilot Chat
1. Open Copilot Chat (`Ctrl+Shift+P` → "GitHub Copilot: Open Chat")
2. Type: `@github write a commit message for my staged changes`
3. Copilot will generate a conventional commit message

### Method 2: Git Integration
1. Stage your changes (`git add .`)
2. In VS Code Source Control panel, click the sparkle icon (✨) next to the commit message box
3. Copilot will suggest a conventional commit message

### Method 3: Command Palette
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Git: Commit (Copilot)"
3. Copilot will generate and pre-fill the commit message

## 📏 Format Rules

### Structure
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Examples
```bash
# Feature addition
feat: add hover provider for component documentation

# Bug fix with scope
fix(parser): resolve YAML parsing for nested components

# Breaking change
feat!: redesign component cache API

# Documentation update
docs: update README with new installation steps

# Performance improvement
perf: optimize component loading with batch requests
```

### Commit Types
- **feat**: New features
- **fix**: Bug fixes
- **docs**: Documentation changes
- **style**: Code style changes (formatting, semicolons, etc.)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **build**: Build system changes
- **ci**: CI configuration changes
- **chore**: Maintenance tasks

## ✅ Validation

The project has automatic validation:

1. **commitlint**: Validates commit message format on commit
2. **Line length**: Maximum 100 characters for first line
3. **Format checking**: Ensures proper conventional commit structure

## 🔧 Customization

To modify the Copilot behavior, edit `.vscode/settings.json`:

```json
{
  "github.copilot.chat.commitMessageConvention": "conventional",
  "github.copilot.chat.commitMessageMaxLength": 100,
  "github.copilot.chat.commitMessageTemplate": "{{type}}{{scope}}: {{description}}"
}
```

## 🚫 Common Mistakes to Avoid

❌ **Don't do this:**
```bash
git commit -m "Fixed bug"
git commit -m "Update README.md file with more information about the installation process and usage examples"
git commit -m "feat: Added new feature for parsing YAML files and detecting components with improved error handling"
```

✅ **Do this:**
```bash
git commit -m "fix: resolve component detection issue"
git commit -m "docs: update README with installation steps"
git commit -m "feat: add YAML parsing with error handling"
```

## 💡 Pro Tips

1. **Use the scope** when changes affect a specific module: `fix(parser):`
2. **Keep descriptions concise** but descriptive
3. **Use imperative mood**: "add" not "added" or "adds"
4. **No capitalization** for the description
5. **No period** at the end of the description
6. **Use body** for complex changes that need explanation
