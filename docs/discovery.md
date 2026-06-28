# Component Discovery

> Advanced configuration for how the extension scans a source repository for components. Most users need none of this — see the [README](../README.md) for the basics.

By default the extension follows the [GitLab CI Components spec](https://docs.gitlab.com/ci/components/#directory-structure) when scanning a source repository: it looks for templates in `templates/` and one subdirectory level deep, matching `*.yml` and `*.yaml`. **No configuration is required for spec-compliant repos.**

For repositories that pre-date the spec, use a custom layout, or store templates outside `templates/`, override discovery either globally or per source.

## Global defaults

```jsonc
"gitlabComponentHelper.discovery.templateRoots": ["templates", "ci/components"],
"gitlabComponentHelper.discovery.maxDepth": 2,
"gitlabComponentHelper.discovery.filePatterns": ["*.yml", "*.yaml"],
"gitlabComponentHelper.discovery.templateFileNames": ["template.yml", "template.yaml"]
```

These four settings are also editable from the **VS Code Settings UI** (search for "GitLab Component Helper Discovery").

## Per-source override

Need different rules for one repository? Add a `discovery` block to that source — its values override the global defaults for that source only.

```jsonc
"gitlabComponentHelper.componentSources": [
  {
    "name": "Standard CI Components",
    "path": "components/opentofu",
    "gitlabInstance": "gitlab.com"
    // uses global discovery defaults
  },
  {
    "name": "Legacy Internal Components",
    "path": "infra/legacy-ci",
    "gitlabInstance": "gitlab.company.com",
    "discovery": {
      "templateRoots": ["ci/components", "shared/pipelines"],
      "maxDepth": 2
    }
  }
]
```

## Limits

To keep the extension fast and predictable:

| Field | Limit |
|---|---|
| `templateRoots` | Up to 5 roots per source |
| `maxDepth` | 0–3 (0 = root only, 1 = one subdirectory level, the spec default) |
| `filePatterns` | Filename globs only — no path globs (e.g. `*.yml` ✅, `foo/*.yml` ❌) |
| `templateFileNames` | Filenames only — no slashes |
