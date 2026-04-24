# Tests

Two layers, answering two different questions.

## `tests/unit/` and `tests/integration/` — characterization tests

Plain Node scripts that spawn under `tests/run-tests.js`. They inline the
algorithms they assert on (URL parsing shape, spec parsing shape, YAML
template detection, hover text composition) rather than importing them
from `src/`. That's deliberate: `src/**/*.ts` transitively imports
`vscode` via `Logger`, so importing real source from plain Node would
require a full `vscode` mock layer for every test — more maintenance
than they're worth.

Treat them as **documentation of intent**: if the algorithm changes,
these tests won't break, but the inline expectation is a durable record
of the behaviour we decided on. They are fast (<1s total), run in every
pre-push and CI build, and exist mainly so trivial regressions (a regex
typo in a copy-pasted helper) get noticed quickly.

Run locally:

```sh
npm test                # all characterization tests
npm run test:unit       # unit/ only
npm run test:integration # integration/ only
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

## Runner behaviour (`run-tests.js`)

Fails on any of:

- non-zero exit from the child
- `Cannot find module ...` in output (catches silently-swallowed require errors)
- `UnhandledPromiseRejectionWarning` / `Unhandled rejection:`
- an explicit `❌ FAIL` / `❌ ERROR` / `FAIL:` marker on a line

Before this change, tests that `try/catch`'d a require failure and
returned normally were reported ✅. That's how two integration tests
passed green for months while never actually running.

## Fixtures

`tests/fixtures/` — sample `.gitlab-ci.yml` and mock component data.
Shared across both layers.
