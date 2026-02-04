# .ai Directory

This directory contains AI-readable project documentation using the AICaC standard.

## Files

- `context.yaml` - Project metadata and overview (REQUIRED)
- `architecture.yaml` - Component relationships (optional)
- `workflows.yaml` - Common tasks and procedures (optional)
- `decisions.yaml` - Architectural decisions (optional)
- `errors.yaml` - Error patterns and solutions (optional)

## Next Steps

1. Review and complete TODO items in `context.yaml`
2. Add additional files as needed for your project
3. Reference this directory from your project's `AGENTS.md`
4. Add an AICaC badge to your README.md

See [AICaC specification](https://github.com/eFAILution/AICaC) for details.

## AI-Assisted Completion

To get help populating these files with AI:

### Using GitHub Copilot
Open files in your editor with Copilot enabled and use inline suggestions.

### Using Claude Code or Cursor
Ask your AI assistant to analyze your project and populate the .ai/ files:
```
Based on my project structure, help me complete the .ai/context.yaml file
and add relevant architecture.yaml and workflows.yaml files.
```

### Using Free AI (via API)
Run the bootstrap script with AI assistance:
```bash
python .github/actions/aicac-adoption/bootstrap.py --with-ai --api-key=YOUR_KEY
```
