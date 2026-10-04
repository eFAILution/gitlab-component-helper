/**
 * Reads and writes `gitlabComponentHelper.versionPreferences`. The pure logic lives in `versionPreferences.ts`.
 */

import * as vscode from 'vscode';
import { isVersionPreferences, withVersionPreference, type VersionPreferences } from './versionPreferences';

const SECTION = 'gitlabComponentHelper';
const SETTING = 'versionPreferences';

/** Serialises writes, so a second quick click reads the map the first one wrote rather than the one before it. */
let pendingWrite: Promise<unknown> = Promise.resolve();

/**
 * Read the effective preferences: user settings with any workspace entries layered on top.
 *
 * @returns The preferences, or an empty map when the setting is missing or malformed.
 */
export function readVersionPreferences(): VersionPreferences {
  const value = vscode.workspace.getConfiguration(SECTION).get<unknown>(SETTING);
  return isVersionPreferences(value) ? value : {};
}

/**
 * Save one component's preference to user settings, after any write already in progress.
 *
 * Only the user-level value is read and rewritten. Writing the merged value back would copy workspace entries into
 * user settings.
 *
 * @param key The component's `versionPreferenceKey`.
 * @param value A version to pin, or `LATEST_VERSION_PREFERENCE`.
 * @returns Whether a workspace entry for the same key holds a different value, which wins over what was saved.
 */
export function saveVersionPreference(key: string, value: string): Promise<{ overriddenByWorkspace: boolean }> {
  const write = pendingWrite.then(() => writeUserPreference(key, value));
  pendingWrite = write.catch(() => undefined);
  return write;
}

async function writeUserPreference(key: string, value: string): Promise<{ overriddenByWorkspace: boolean }> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const inspected = config.inspect<unknown>(SETTING);
  const userValue = isVersionPreferences(inspected?.globalValue) ? inspected.globalValue : {};

  await config.update(SETTING, withVersionPreference(userValue, key, value), vscode.ConfigurationTarget.Global);

  const workspaceValues = [inspected?.workspaceValue, inspected?.workspaceFolderValue];
  const overriddenByWorkspace = workspaceValues.some(
    (scoped) => isVersionPreferences(scoped) && Object.prototype.hasOwnProperty.call(scoped, key) && scoped[key] !== value,
  );
  return { overriddenByWorkspace };
}
