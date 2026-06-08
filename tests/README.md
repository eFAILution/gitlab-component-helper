# Tests

Two layers, answering two different questions.

## `tests/unit/` — fast unit tests

Mocha tests (`.mocharc.cjs`, TDD `suite`/`test`, `node:assert/strict`) that
import the real `src/` code they assert on. `tsx` loads the TypeScript
sources directly, and modules that touch `vscode` resolve it lazily (via
`Logger`'s `createRequire`) so they import cleanly under plain Node. Where
a behaviour lived inside a `vscode`-coupled class, the pure part is
extracted into an importable helper and tested directly — e.g. the
catalog-fetch pipeline lives in `componentFetcherTemplates.ts`
(`fetchAllTemplateFiles` / `buildCatalogComponents`) and is covered by
`catalogPipeline.test.ts` with a duck-typed HTTP client.

They are fast (<1s total) and run in every pre-push and CI build.

Run locally:

```sh
npm test  # the full Mocha unit suite
```

## `tests/extension-host/` — real-code tests

Run inside a headless VS Code via `@vscode/test-electron`. `vscode`
resolves naturally, so these import real providers and exercise them
against synthetic `TextDocument`s. This is the layer that actually
replaces "F5 and poke at things in the Extension Host" — if you catch
yourself reaching for the debugger to verify a hover, completion, or
diagnostic, add the case here instead.

Run locally:

```sh
npm run test:extension-host
```

On Linux CI this runs under `xvfb-run`.

## Fixtures

`tests/fixtures/` — sample `.gitlab-ci.yml` and mock component data,
used by the extension-host tests.
