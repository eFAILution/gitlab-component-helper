/**
 * Shape contract for the Component Browser's webview-facing tree.
 *
 * The browser presents components in a nested hierarchy: `source → project → component → versions`.
 * Two shape families exist:
 *
 * - **Builder shapes** ({@link SourceGroupBuilder}, {@link ProjectGroupBuilder}, {@link ComponentGroupBuilder})
 *   carry `Map<string, …>` collections used while walking the flat cached-component list. The maps let
 *   the transform deduplicate sources/projects/components by key without scanning arrays.
 * - **Tree shapes** ({@link SourceGroup}, {@link ProjectGroup}, {@link ComponentGroup}, {@link ComponentVersion})
 *   are the flat-array form returned to the webview. Built by flattening the builder maps via `Array.from(…)`.
 *
 * Both families share the same conceptual node types — the only structural difference is `Map` vs `Array`
 * for the collection fields.
 */

import type { ComponentParameter } from '../types/git-component';

// -----------------------------------------------------------------------------
// Builder shapes — used during transform, never reach the webview
// -----------------------------------------------------------------------------

/** Top-level group built per `source` (e.g. `Components`, `My Group`). Holds projects under that source. */
export interface SourceGroupBuilder {
  source: string;
  type: 'source';
  isExpanded: boolean;
  projects: Map<string, ProjectGroupBuilder>;
  totalComponents: number;
  totalVersions: number;
}

/** A project within a source (e.g. a single GitLab repo). Holds components under that project. */
export interface ProjectGroupBuilder {
  name: string;
  path: string;
  gitlabInstance: string;
  type: 'project';
  isExpanded: boolean;
  components: Map<string, ComponentGroupBuilder>;
}

/** A single component within a project, with one or more versions accumulated as the transform sees them. */
export interface ComponentGroupBuilder {
  name: string;
  description: string;
  summary?: string;
  usage?: string;
  notes?: string[];
  rawYaml?: string;
  parameters: ComponentParameter[];
  source: string;
  sourcePath: string;
  gitlabInstance: string;
  documentationUrl: string;
  versions: Map<string, ComponentVersion>;
  defaultVersion: string;
  availableVersions: string[];
}

// -----------------------------------------------------------------------------
// Tree shapes — what the webview consumes
// -----------------------------------------------------------------------------

/** Webview-facing source group with project counts and flattened project list. */
export interface SourceGroup {
  source: string;
  type: 'source';
  isExpanded: boolean;
  totalComponents: number;
  totalVersions: number;
  projectCount: number;
  componentCount: number;
  projects: ProjectGroup[];
}

/** Webview-facing project group with flattened component list. */
export interface ProjectGroup {
  name: string;
  path: string;
  gitlabInstance: string;
  type: 'project';
  isExpanded: boolean;
  components: ComponentGroup[];
}

/** Webview-facing component group with flattened version list. */
export interface ComponentGroup {
  name: string;
  description: string;
  summary?: string;
  usage?: string;
  notes?: string[];
  rawYaml?: string;
  parameters: ComponentParameter[];
  source: string;
  sourcePath: string;
  gitlabInstance: string;
  documentationUrl: string;
  versions: ComponentVersion[];
  versionCount: number;
  defaultVersion: string;
  availableVersions: string[];
}

/**
 * One version entry for a component. Same shape in both the builder map and the final tree array — the
 * `versions: Map<string, ComponentVersion>` flattens straight into `versions: ComponentVersion[]` without
 * reshaping. Optional fields mirror the catalog spec-header pass-through (`summary`/`usage`/`notes`/`rawYaml`).
 */
export interface ComponentVersion {
  version: string;
  description: string;
  summary?: string;
  usage?: string;
  notes?: string[];
  rawYaml?: string;
  parameters: ComponentParameter[];
  documentationUrl: string;
  source: string;
  sourcePath: string;
  gitlabInstance: string;
}
