# Monorepo Tag Conventions

> How to scope per-component versions in a tag-per-component monorepo. Skip this for ordinary single-component repos — their tags are listed as-is. See the [README](../README.md) for the basics.

When a single repository holds **many components**, each component is usually released under its own tags that embed the component name — e.g. `deploy-app-1.1.0`, `deploy-app-2`, `build-image-4.0.0`. Without any hint, the version dropdown for *every* component would list *every* tag in the repo.

Set a **tag pattern** on the source to tell the extension how tags map to components. Each component's dropdown is then scoped to its own tags, and labels are shown without the prefix (e.g. `1.1.0`, not `deploy-app-1.1.0`). The full tag is still what gets inserted, so the GitLab include resolves correctly.

```jsonc
"gitlabComponentHelper.componentSources": [
  {
    "name": "Shared CI Monorepo",
    "path": "infrastructure/shared-ci",
    "gitlabInstance": "gitlab.com",
    "tagPattern": "{name}-{version}"
  }
]
```

The template uses two tokens:

| Token | Meaning |
|---|---|
| `{name}` | The component (= `templates/` directory) name. |
| `{version}` | The version shown in the dropdown. Matches anything starting with a digit. |

Everything else in the pattern is literal text, so other conventions work too:

| Tag style | Pattern |
|---|---|
| `deploy-app-1.1.0` | `{name}-{version}` |
| `apps/web/v2.0.0` | `apps/{name}/v{version}` |
| `web_1.0.0` | `{name}_{version}` |

> **Sibling names:** because `{version}` must start with a digit, a component named `build-image` won't pick up a sibling's `build-image-extra-1.0.0` tags. If you need pre-release-only tags with no leading digit (e.g. `web-rc1`), write a stricter custom pattern for that source.

Leave `tagPattern` unset for ordinary single-component repos.

> **Note:** the [version-check feature](../README.md#-stay-on-the-latest-version) only compares clean `X.Y.Z` refs, so components pinned to a full monorepo tag (e.g. `deploy-app@deploy-app-1.1.0`) are not currently flagged as outdated. Scoped monorepo comparison is planned.
