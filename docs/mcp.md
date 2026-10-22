# MCP server

GitLab Component Helper ships a [Model Context Protocol](https://modelcontextprotocol.io) server. Coding agents use it
to check the GitLab CI/CD components in your repository and to fix them: unknown or missing inputs, local includes that
point nowhere, and components with a newer stable version.

The server reads your workspace and GitLab. It never edits files. It returns findings with `suggestedEdits`, and the
agent applies them through its own edit and approval flow.

## Tools

| Tool | What it does |
|---|---|
| `validate_ci_file` | Findings for a file, a directory, or every GitLab CI file in the workspace: unknown inputs, missing required inputs, missing local includes, unfetchable components, outdated versions. Pick checks with `checks: ["inputs", "versions", "local-includes"]`. |
| `get_component_spec` | The inputs a component version declares: name, type, required, default, options, description. Also the available versions and the latest stable one. |
| `check_component_versions` | Only the outdated-version findings, each with an edit that bumps the pinned version. |
| `list_component_usages` | Every component and local include, with its line, version, and the input names passed. |
| `list_component_versions` | Tags, branches, and the latest stable version of a component. |

## Use it in VS Code with GitHub Copilot

The extension registers the server with VS Code, so there is nothing to install or configure.

1. Install or update GitLab Component Helper (0.21.5 or later on the beta channel).
2. Open the Chat view and switch to **Agent** mode.
3. Open the tools picker (the tools icon in the chat input) and make sure **GitLab Component Helper** is enabled.
4. The first time an agent uses the server, VS Code may ask you to trust or start it. Allow it. You can also start,
   stop, and inspect it with the **MCP: List Servers** command.

The server gets your workspace folders as its roots, your `gitlabComponentHelper.*` settings, and the tokens you saved
with **GitLab CI: Add Component Project/Group**. Tokens are passed to the server process when VS Code starts it. They
never appear in settings or logs.

### Prompts to try

- "Find and fix the GitLab CI component problems in this repo."
- "Validate `.gitlab-ci.yml` and fix any unknown or missing component inputs."
- "Which components in this repo are out of date? Upgrade them, and check each new version's inputs before you change
  anything."
- "What inputs does `gitlab.com/components/opentofu/full-pipeline@2.0.0` take?"

## Use it with other MCP clients

The server is `out/mcp/server.js` inside the installed extension, for example
`~/.vscode/extensions/efailution.gitlab-component-helper-<version>/out/mcp/server.js`. It needs Node.js 22 or later.
It is not published to npm yet.

```json
{
  "mcpServers": {
    "gitlab-component-helper": {
      "command": "node",
      "args": ["/path/to/out/mcp/server.js", "--root", "/path/to/your/repo"],
      "env": { "GCH_TOKEN_GITLAB_COM": "<personal access token with read_api>" }
    }
  }
}
```

### Options

| Option | Meaning |
|---|---|
| `--root <dir>` | A workspace root the tools may read. Repeat it for several. Default: the working directory. |
| `--cache-dir <dir>` | Where to keep the component cache. Default: `GCH_CACHE_DIR`, else `$XDG_CACHE_HOME` or `~/.cache`, then `gitlab-component-helper/mcp`. |
| `--log-level <level>` | `DEBUG`, `INFO`, `WARN`, or `ERROR`. Logs go to stderr. Default: `GCH_LOG_LEVEL`, else the `logLevel` setting. |
| `--config <json>` | Settings as JSON, for example `'{"componentSources":[...]}'`. |

### Settings

Settings are read in this order, and the first that sets a key wins:

1. `--config`
2. `GCH_CONFIG_JSON`
3. `GCH_LOG_LEVEL` (for `logLevel`)
4. `<first root>/.gitlab-component-helper.json`, keys without the `gitlabComponentHelper.` prefix
5. `<first root>/.vscode/settings.json`, the `gitlabComponentHelper.*` keys
6. The extension's defaults

The keys are the same as the [extension settings](../README.md#settings-reference). `gitlabToken` is refused
everywhere: pass tokens through the environment.

### Tokens

- `GCH_TOKEN_<HOST>` sets a token for one GitLab instance. The host is upper-cased, with `.`, `-`, and `:` turned into
  `_`. For example, use `GCH_TOKEN_GITLAB_COM` for gitlab.com and `GCH_TOKEN_GITLAB_EXAMPLE_COM` for
  gitlab.example.com.
- `GITLAB_TOKEN` is used for the host in `GITLAB_HOST`, which defaults to gitlab.com.

A `GCH_TOKEN_<HOST>` token is only used for a host named in `--config` or `GCH_CONFIG_JSON` `componentSources`, or in
`GCH_TOKEN_HOSTS` (comma-separated). A host named only in a file inside the repository never gets one. The server reads
the token variables once and removes them from its environment, so the `git` processes it starts never see them.

Anyone who can read your process environment as the same OS user can read tokens passed this way. That is the same
exposure as any CLI tool that takes a token from the environment.

### Which hosts the server contacts

Only HTTPS to gitlab.com, the `gitlabInstance` of each `componentSources` entry, and hosts you gave a token for. It
never contacts private, loopback, or link-local addresses. A component on any other host is reported with the host
name and how to allow it: add it to `componentSources`.

### Which files the server reads

Only regular files of up to 1 MB under the roots. Paths with `..`, symlinks that lead outside a root, and missing files
all get the same "not found under the workspace roots" answer.

## Protocol

Newline-delimited JSON-RPC 2.0 over stdio. The server negotiates MCP revisions 2025-11-25, 2025-06-18, 2025-03-26, and
2024-11-05. `structuredContent` and `outputSchema` are sent on 2025-06-18 and later. Every tool result also has a text
block. The stateless 2026-07-28 revision isn't implemented: a client that probes with `server/discover` gets "method
not found" and falls back to `initialize`.
