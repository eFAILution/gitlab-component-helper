# Grammar fixtures

`redhat-yaml.tmLanguage.json` is the YAML grammar from [Red Hat's YAML extension](https://github.com/redhat-developer/vscode-yaml) 2.0.0, copied unchanged. This extension's `extensionPack` installs Red Hat YAML, and its grammar replaces VS Code's built-in `source.yaml` grammar. `tests/extension-host/suite/scriptGrammar.test.ts` runs the script highlighting tests against both, because users can have either one.

MIT License, Copyright (c) 2017 Red Hat Inc. and others.
