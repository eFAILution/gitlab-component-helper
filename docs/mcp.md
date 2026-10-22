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

When an in-editor AI client starts the server, it gets:

- your workspace folders as its roots (with no folder open, no server is offered)
- your `gitlabComponentHelper.*` settings. Network, cache, and logging settings come from your user settings only;
  a workspace's `.vscode/settings.json` can only change catalog and checking settings
- the tokens you saved with **GitLab CI: Add Component Project/Group**, for the instances in your token list and in your
  **user** `componentSources` setting (never instances named only by workspace or folder settings)

Tokens are passed to the server process as one `GCH_TOKENS_JSON` variable when VS Code starts it, and the server
removes it from its environment right away. Tokens never appear in settings or logs. To stop offering the server, turn
off `gitlabComponentHelper.mcp.enabled`. It is an application setting, so a workspace can't turn it back on. After you
add or change a token, VS Code restarts the server so it picks the change up.

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

The two files inside the repository (4 and 5) may only set catalog and checking behavior: `componentSources`,
`discovery.*`, `additionalFileGlobs`, `versionCheck.*`, and `versionPreferences`. Network, cache, and logging settings
(`httpTimeout`, `retryAttempts`, `batchSize`, `cacheTime`, `logLevel`) from those files are ignored with a warning. A
`componentSources` host that only those files name is listed but never contacted (see below).

### Tokens

- `GCH_TOKENS_JSON`: a JSON object of exact host (with `:port` if not 443) to token, for example
  `{"gitlab.example.com": "glpat-..."}`. Each token is used only for exactly its host. This is what the extension
  passes.
- `GCH_TOKEN_<HOST>`: a token for one instance. The host is upper-cased, with `.`, `-`, and `:` turned into `_`, so
  `GCH_TOKEN_GITLAB_COM` is gitlab.com and `GCH_TOKEN_GITLAB_EXAMPLE_COM` is gitlab.example.com. That name could also
  belong to `gitlab-example.com`, so such a token is only used for gitlab.com or a host you name in `GCH_TOKEN_HOSTS`
  (comma-separated) or in `--config` `componentSources`. A host named by `GCH_CONFIG_JSON` or a repository file never
  gets one, and if two named hosts share a variable name, neither does.
- `GITLAB_TOKEN`: used for the host in `GITLAB_HOST`, which defaults to gitlab.com.

For terminal setups, prefer `GCH_TOKENS_JSON`: it binds each token to exactly one host, with nothing left to guess.

Tokens are trimmed, so a trailing newline from pasting is fine. A token with control characters in it is ignored with
a warning that names the variable, not the token. The server reads all token variables once and removes them from its
environment, so the `git` processes it starts never see them.

Anyone who can read your process environment as the same OS user can read tokens passed this way. That is the same
exposure as any CLI tool that takes a token from the environment.

### Which hosts the server contacts

Only HTTPS, and only to hosts the launcher trusts:

- gitlab.com
- hosts you gave a token for
- the `componentSources` hosts from `--config`
- hosts in `GCH_TRUSTED_HOSTS` (comma-separated). The extension fills it from your **user** `componentSources`.

Hosts are matched with their port, so `gitlab.example.com:8443` must be listed as such. A host named only by the
repository's `.gitlab-component-helper.json` or `.vscode/settings.json` (or by `GCH_CONFIG_JSON`) is never contacted: a
cloned repository must not choose where the server sends requests. A component on such a host is reported in
`blockedHosts` with how to allow it: add it to your user settings, not to the repository.

Self-managed GitLab on an internal network works. Link-local addresses (like the 169.254.169.254 cloud metadata
endpoint), other known metadata endpoints, unspecified, and multicast addresses are always refused, also when written
as IPv6 that carries an IPv4 address. Plain `http://` instances aren't supported.

### Limits

- Each response body is capped at 10 MB.
- Each request must finish within three `httpTimeout` periods. `httpTimeout` is clamped to 1-60 s and `retryAttempts`
  to 0-5. Refused requests are never retried.
- Each tool call stops after 60 s, and at most 4 run at once.
- A file walk covers at most 500 CI files and 5000 directories. It skips `node_modules`, `.git`, `.venv`, `venv`,
  `target`, `dist`, `build`, `out`, `.next`, `vendor`, `.terraform`, and `coverage`.

### Which files the server reads

Only regular files of up to 1 MB under the roots. A path must be inside a root as written and after resolving
symlinks. Symlinks are checked one at a time before anything resolves them: a link must be relative and stay inside
the roots, so a link to an absolute path (for example a network mount) is refused. Paths with `..`, UNC and `\\?\`
paths, symlinks that lead outside a root, and missing files all get the same
"not found under the workspace roots" answer. FIFOs and devices are never opened. The repository's config files are
read through the same checks.

### Edits

Findings and `check_component_versions` results carry `suggestedEdits`. In `range` and `suggestedEdits`, `line` is
0-based and `startCol`/`endCol` are 0-based UTF-16 offsets. Replace that range with `newText`.

## Protocol

Newline-delimited JSON-RPC 2.0 over stdio. The server negotiates MCP revisions 2025-11-25, 2025-06-18, 2025-03-26, and
2024-11-05. `structuredContent` and `outputSchema` are sent on 2025-06-18 and later. Every tool result also has a text
block. The stateless 2026-07-28 revision isn't implemented: a client that probes with `server/discover` gets "method
not found" and falls back to `initialize`. Invalid tool arguments come back as an `isError` tool result. A request
cancelled with `notifications/cancelled` gets no response.
