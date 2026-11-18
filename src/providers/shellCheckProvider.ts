import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { CONFIG_DEFAULTS } from '../core/config/defaults';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';
import { Logger } from '../utils/logger';
import { extractLintUnits, type LintUnit } from '../utils/shellScriptExtractor';
import {
  buildShellcheckArgs,
  disableDirectiveEdit,
  filterGitLabFalsePositives,
  isShellcheckLevel,
  isShellcheckShell,
  mapToSource,
  parseShellcheckJson,
  type ShellcheckLevel,
  type ShellcheckOptions,
  type SourceFinding,
} from '../utils/shellcheckOutput';

/** Settings section for every ShellCheck setting. */
const CONFIG_SECTION = 'gitlabComponentHelper.shellcheck';
/** `globalState` key set when the user chooses "Don't show again" on the missing-binary message. */
const MISSING_BINARY_DISMISSED_KEY = 'gitlabComponentHelper.shellcheck.missingBinaryDismissed';
/** Command behind the "Ignore SC#### in workspace settings" quick fix; not in the Command Palette. */
const EXCLUDE_CODE_COMMAND = 'gitlabComponentHelper.shellcheck.excludeCode';
/** Wait after the last edit before linting. */
const DEBOUNCE_MS = 500;
/** Longest a single ShellCheck run may take before it's killed. */
const RUN_TIMEOUT_MS = 10_000;
/** ShellCheck processes run at once for one document. */
const MAX_CONCURRENT_RUNS = 4;

/** VS Code severity for each ShellCheck level; `style` findings show as hints rather than squiggles. */
const SEVERITY: Record<ShellcheckLevel, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  style: vscode.DiagnosticSeverity.Hint,
};

/** The ShellCheck binary couldn't be found (ENOENT); the message is the command that was tried. */
class ShellcheckNotFoundError extends Error {}

/** The `gitlabComponentHelper.shellcheck.*` settings, validated. */
interface Settings {
  enabled: boolean;
  /** Binary to run: the configured path, else `shellcheck` from `PATH`. */
  command: string;
  /** Dialect, minimum severity and excluded codes passed to ShellCheck. */
  options: ShellcheckOptions;
  /** Names or globs of variables set outside the file, so SC2154 isn't reported for them. */
  knownVariables: string[];
}

/**
 * @returns The `gitlabComponentHelper.shellcheck.*` settings, with invalid values replaced by their defaults.
 */
function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const shell = config.get<string>('shell');
  const severity = config.get<string>('severity');
  return {
    enabled: config.get<boolean>('enabled', CONFIG_DEFAULTS['shellcheck.enabled']),
    command: config.get<string>('path', CONFIG_DEFAULTS['shellcheck.path']).trim() || 'shellcheck',
    options: {
      shell: isShellcheckShell(shell) ? shell : CONFIG_DEFAULTS['shellcheck.shell'],
      severity: isShellcheckLevel(severity) ? severity : CONFIG_DEFAULTS['shellcheck.severity'],
      exclude: config.get<string[]>('exclude', CONFIG_DEFAULTS['shellcheck.exclude']),
    },
    knownVariables: config.get<string[]>('knownVariables', CONFIG_DEFAULTS['shellcheck.knownVariables']),
  };
}

/**
 * Runs ShellCheck with `input` on stdin. ShellCheck exits non-zero when it has findings, so any run that produced
 * output counts as success.
 *
 * @param command - Binary name or path.
 * @param args - ShellCheck arguments.
 * @param input - Script to lint.
 * @returns ShellCheck's stdout.
 */
function runShellcheck(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { timeout: RUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error?.code === 'ENOENT') reject(new ShellcheckNotFoundError(command));
        else if (stdout) resolve(stdout);
        else if (error) reject(error);
        else resolve('');
      },
    );
    // The process may exit before reading all of stdin; the callback reports the outcome.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/** Where each diagnostic's disable directive can go, for the document version the diagnostics were made from. */
interface DirectiveTargets {
  version: number;
  /** Source offset keyed by {@link diagnosticKey}; absent when the finding is not in a literal block. */
  offsets: Map<string, number>;
}

/**
 * Code actions get copies of diagnostics, so match them by range and code rather than identity.
 *
 * @param range - Diagnostic range.
 * @param code - `SC####`.
 * @returns A key stable across copies.
 */
function diagnosticKey(range: vscode.Range, code: string): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}:${code}`;
}

/**
 * @param diagnostic - Any diagnostic.
 * @returns Its `SC####` code, or `undefined` when it has none.
 */
function diagnosticCode(diagnostic: vscode.Diagnostic): string | undefined {
  const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
  return typeof code === 'string' && /^SC\d{4}$/.test(code) ? code : undefined;
}

/**
 * Lints GitLab CI `before_script` / `script` / `after_script` blocks with the user's ShellCheck binary and reports
 * findings as diagnostics on the YAML, with quick fixes to disable a code for one command or the workspace.
 */
export class ShellCheckProvider implements vscode.CodeActionProvider {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('gitlab-component-helper-shellcheck');
  private readonly directiveTargets = new Map<string, DirectiveTargets>();
  private readonly timeouts = new Map<string, NodeJS.Timeout>();
  private readonly logger = Logger.getInstance();
  /** Set once the binary is found missing; cleared when settings change so a fixed path is retried. */
  private binaryMissing = false;
  private missingBinaryNotified = false;

  /**
   * Registers the document and settings listeners, the quick-fix provider and the exclude command, then lints the
   * documents already open.
   *
   * @param context - Extension context; owns every registration.
   */
  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this.diagnostics,
      vscode.workspace.onDidOpenTextDocument(doc => this.lint(doc)),
      vscode.workspace.onDidChangeTextDocument(e => this.schedule(e.document)),
      vscode.workspace.onDidSaveTextDocument(doc => this.lint(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => this.clear(doc)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(CONFIG_SECTION) || e.affectsConfiguration('gitlabComponentHelper.additionalFileGlobs')) {
          this.binaryMissing = false;
          this.lintOpenDocuments();
        }
      }),
      { dispose: () => this.timeouts.forEach(clearTimeout) },
      vscode.languages.registerCodeActionsProvider({ language: 'yaml', scheme: 'file' }, this, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }),
      vscode.commands.registerCommand(EXCLUDE_CODE_COMMAND, (code: unknown) => this.excludeCode(code)),
    );
    this.lintOpenDocuments();
  }

  /**
   * Quick fixes for ShellCheck diagnostics: disable the code for the command (only where a directive line reaches
   * ShellCheck) and ignore it in workspace settings.
   *
   * @param document - Document the diagnostics are on.
   * @param _range - Unused; actions are offered per diagnostic.
   * @param context - Diagnostics at the requested range.
   * @returns Actions for the ShellCheck diagnostics in `context`.
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const targets = this.directiveTargets.get(document.uri.toString());
    return context.diagnostics.flatMap(diagnostic => {
      const code = diagnostic.source === 'shellcheck' ? diagnosticCode(diagnostic) : undefined;
      if (!code) return [];
      const actions: vscode.CodeAction[] = [];

      const offset = targets?.version === document.version
        ? targets.offsets.get(diagnosticKey(diagnostic.range, code))
        : undefined;
      const disable = offset === undefined ? undefined : this.disableForCommand(document, offset, code, diagnostic);
      if (disable) actions.push(disable);

      const exclude = new vscode.CodeAction(`Ignore ${code} in workspace settings`, vscode.CodeActionKind.QuickFix);
      exclude.diagnostics = [diagnostic];
      exclude.command = { title: exclude.title, command: EXCLUDE_CODE_COMMAND, arguments: [code] };
      actions.push(exclude);
      return actions;
    });
  }

  /**
   * @param document - Document to edit.
   * @param offset - Source offset of the first character of the flagged command.
   * @param code - `SC####` to disable.
   * @param diagnostic - Diagnostic the action fixes.
   * @returns An action adding or extending a `# shellcheck disable=` line, or `undefined` when one already covers
   * `code`.
   */
  private disableForCommand(
    document: vscode.TextDocument,
    offset: number,
    code: string,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction | undefined {
    const line = document.positionAt(offset).line;
    const previous = line > 0 ? document.lineAt(line - 1).text : undefined;
    const edit = disableDirectiveEdit(document.lineAt(line).text, previous, Number(code.slice(2)));
    if (!edit) return undefined;

    const action = new vscode.CodeAction(`Disable ${code} for this command`, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    action.edit = new vscode.WorkspaceEdit();
    if (edit.kind === 'insert') {
      const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      action.edit.insert(document.uri, new vscode.Position(line, 0), edit.text + eol);
    } else {
      action.edit.replace(document.uri, document.lineAt(line - 1).range, edit.text);
    }
    return action;
  }

  /**
   * Adds `code` to `shellcheck.exclude` in workspace settings, or user settings when no folder is open.
   *
   * @param code - Command argument; ignored unless it is an `SC####` code not already excluded.
   */
  private async excludeCode(code: unknown): Promise<void> {
    if (typeof code !== 'string' || !/^SC\d{4}$/.test(code)) return;
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const current = config.inspect<string[]>('exclude');
    const existing = (target === vscode.ConfigurationTarget.Workspace ? current?.workspaceValue : current?.globalValue)
      ?? [];
    if (existing.some(entry => entry.trim().toUpperCase().replace(/^(SC)?/, 'SC') === code)) return;
    await config.update('exclude', [...existing, code], target);
  }

  /** Lints every open document that qualifies. */
  public lintOpenDocuments(): void {
    vscode.workspace.textDocuments.forEach(doc => this.lint(doc));
  }

  /**
   * @param document - Candidate document.
   * @returns `true` for an on-disk GitLab CI YAML file in a trusted workspace.
   */
  private isLintable(document: vscode.TextDocument): boolean {
    // `file` only: a diff view's source panel shares the path and would get duplicate squiggles.
    return document.uri.scheme === 'file'
      && document.languageId === 'yaml'
      && vscode.workspace.isTrusted
      && isGitLabCIFile(document);
  }

  /**
   * Lints `document` once edits pause, restarting the debounce on each change.
   *
   * @param document - Edited document.
   */
  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.timeouts.get(key));
    this.timeouts.set(key, setTimeout(() => {
      this.timeouts.delete(key);
      this.lint(document);
    }, DEBOUNCE_MS));
  }

  /**
   * Drops a closed document's pending lint, diagnostics and directive positions.
   *
   * @param document - Closed document.
   */
  private clear(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.timeouts.get(key));
    this.timeouts.delete(key);
    this.diagnostics.delete(document.uri);
    this.directiveTargets.delete(key);
  }

  /**
   * Lints `document` and replaces its diagnostics. Results for an outdated version are dropped; a missing binary
   * disables linting until settings change.
   *
   * @param document - Document to lint.
   */
  private async lint(document: vscode.TextDocument): Promise<void> {
    if (!this.isLintable(document)) return;
    const settings = readSettings();
    if (!settings.enabled || this.binaryMissing) {
      this.diagnostics.delete(document.uri);
      return;
    }

    const version = document.version;
    const units = extractLintUnits(document.getText());
    try {
      const findings = await this.runAll(units, settings);
      if (document.isClosed || document.version !== version) return;
      const offsets = new Map<string, number>();
      this.diagnostics.set(document.uri, this.toDiagnostics(document, findings, offsets));
      this.directiveTargets.set(document.uri.toString(), { version, offsets });
    } catch (error) {
      if (error instanceof ShellcheckNotFoundError) {
        this.binaryMissing = true;
        this.diagnostics.delete(document.uri);
        this.logger.info(`[ShellCheckProvider] ShellCheck not found at '${settings.command}'`, 'ShellCheckProvider');
        void this.notifyMissingBinary();
      } else {
        this.logger.warn(`[ShellCheckProvider] ShellCheck failed: ${error}`, 'ShellCheckProvider');
      }
    }
  }

  /**
   * Runs ShellCheck over each unit, at most {@link MAX_CONCURRENT_RUNS} at a time.
   *
   * @param units - Lint units for one document.
   * @param settings - Current settings.
   * @returns Filtered findings positioned in the source.
   */
  private async runAll(units: LintUnit[], settings: Settings): Promise<SourceFinding[]> {
    const args = buildShellcheckArgs(settings.options);
    const results: SourceFinding[][] = [];
    let next = 0;
    /** Takes the next unit until none are left; several run side by side. */
    const worker = async (): Promise<void> => {
      while (next < units.length) {
        const unit = units[next++];
        const stdout = await runShellcheck(settings.command, args, unit.content);
        const comments = filterGitLabFalsePositives(unit, parseShellcheckJson(stdout), settings.knownVariables);
        results.push(mapToSource(unit, comments));
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_RUNS, units.length) }, worker));
    return results.flat();
  }

  /**
   * Converts findings to diagnostics, dropping duplicates and widening zero-width ranges to the word.
   *
   * @param document - Document the findings are in.
   * @param findings - Findings with source offsets.
   * @param directiveOffsets - Filled with each diagnostic's directive position, keyed by {@link diagnosticKey}.
   * @returns Diagnostics linked to each code's wiki page.
   */
  private toDiagnostics(
    document: vscode.TextDocument,
    findings: SourceFinding[],
    directiveOffsets: Map<string, number>,
  ): vscode.Diagnostic[] {
    const seen = new Set<string>();
    return findings.flatMap(finding => {
      const id = `${finding.start}:${finding.end}:${finding.code}`;
      if (seen.has(id)) return [];
      seen.add(id);

      const start = document.positionAt(finding.start);
      const range = finding.end > finding.start
        ? new vscode.Range(start, document.positionAt(finding.end))
        : document.getWordRangeAtPosition(start) ?? new vscode.Range(start, start.translate(0, 1));
      const diagnostic = new vscode.Diagnostic(range, finding.message, SEVERITY[finding.level]);
      diagnostic.source = 'shellcheck';
      diagnostic.code = {
        value: `SC${finding.code}`,
        target: vscode.Uri.parse(`https://www.shellcheck.net/wiki/SC${finding.code}`),
      };
      if (finding.directiveOffset !== undefined) {
        directiveOffsets.set(diagnosticKey(range, `SC${finding.code}`), finding.directiveOffset);
      }
      return [diagnostic];
    });
  }

  /** Shows the missing-binary message once per session, unless the user chose "Don't show again". */
  private async notifyMissingBinary(): Promise<void> {
    if (this.missingBinaryNotified || this.context.globalState.get<boolean>(MISSING_BINARY_DISMISSED_KEY)) return;
    this.missingBinaryNotified = true;
    const dontShow = "Don't show again";
    const choice = await vscode.window.showInformationMessage(
      'GitLab Component Helper lints CI script blocks with ShellCheck, but it was not found. Install ShellCheck or ' +
        'set gitlabComponentHelper.shellcheck.path.',
      'Open Settings',
      dontShow,
    );
    if (choice === dontShow) {
      await this.context.globalState.update(MISSING_BINARY_DISMISSED_KEY, true);
    } else if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
    }
  }
}
