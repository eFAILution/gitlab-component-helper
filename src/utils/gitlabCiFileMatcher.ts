import * as vscode from "vscode";

export const DEFAULT_GITLAB_CI_FILE_GLOBS = [
  "**/.gitlab-ci.yml",
  "**/.gitlab-ci.yaml",
  "**/.gitlab/**/*.yml",
  "**/.gitlab/**/*.yaml",
];

export function getConfiguredFileGlobs(): string[] {
  const additional = vscode.workspace
    .getConfiguration("gitlabComponentHelper")
    .get<string[]>("additionalFileGlobs", []);
  return [...DEFAULT_GITLAB_CI_FILE_GLOBS, ...additional];
}

/**
 *  Languages the providers explicitly support regardless of filename. `shellscript` is here because providers register
 *  on it to surface inside `script:` blocks. A globs-only check wouldn't catch those documents.
 */
const ALLOWED_LANGUAGE_IDS = new Set(["gitlab-ci", "shellscript"]);

export function isGitLabCIFile(document: vscode.TextDocument): boolean {
  if (ALLOWED_LANGUAGE_IDS.has(document.languageId)) return true;

  for (const glob of getConfiguredFileGlobs()) {
    if (vscode.languages.match({ pattern: glob }, document) > 0) return true;
  }
  return false;
}
