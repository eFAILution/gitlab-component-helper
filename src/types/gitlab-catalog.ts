import type { ParameterDefault } from './git-component';
import type { ComponentVariable } from '../parsers/specParser';

export interface GitLabCatalogComponent {
  name: string;
  description?: string;
  summary?: string;
  usage?: string;
  notes?: string[];
  rawYaml?: string;
  documentation_url?: string;
  latest_version?: string;
  variables?: GitLabCatalogVariable[];
}

export interface GitLabCatalogVariable {
  name: string;
  description?: string;
  required?: boolean;
  type?: string;
  default?: ParameterDefault;
}

/**
 * Represents a YAML fragment file containing reusable anchors
 * These are files in templates/ that don't have a spec: section
 * but contain YAML anchors (keys starting with '.') that can be
 * extended via 'extends:' or included via 'local:'
 */
export interface GitLabYamlFragment {
  type: 'fragment';
  name: string;
  fileName: string;
  description?: string;
  summary?: string;
  usage?: string;
  notes?: string[];
  rawYaml?: string;
  latest_version?: string;
  anchors: GitLabFragmentAnchor[];
}

/**
 * Represents a YAML anchor within a fragment file
 */
export interface GitLabFragmentAnchor {
  /** Anchor name including the leading dot (e.g., '.common-script') */
  name: string;
  /** Description extracted from comment above the anchor */
  description?: string;
  /** Detected anchor type based on content analysis */
  type: 'job' | 'variables' | 'before_script' | 'after_script' | 'rules' | 'generic';
}

export interface GitLabCatalogData {
  components: GitLabCatalogComponent[];
  /** YAML fragments containing reusable anchors */
  fragments?: GitLabYamlFragment[];
}

/**
 * A single component after we've fetched its template YAML and parsed it locally. Distinct from
 * {@link GitLabCatalogComponent} (the raw API shape).
 */
export interface ParsedCatalogComponent {
  /** Component name as it appears in the template path (e.g. `my-job` for `templates/my-job.yml`). */
  name: string;
  /** Human-readable description extracted from the template's `spec.description` field. */
  description: string;
  /**
   * Input variables defined by the component. Typed as the parser's {@link ComponentVariable}
   * (`default?: string`) rather than the catalog API's {@link GitLabCatalogVariable}
   * (`default?: ParameterDefault`) because we re-parse the template locally.
   */
  variables: ComponentVariable[];
  /** Git ref (tag or branch) the template was fetched at. */
  latest_version: string;
  /** Repo-relative path where the template was found (e.g. `templates/my-job.yml`). */
  templatePath: string;
  /** Optional external documentation URL declared in the template's `spec.documentation_url`. */
  documentation_url?: string;
  /** Short one-line summary from the template's spec header (when present). */
  summary?: string;
  /** Usage instructions from the template's spec header (when present). */
  usage?: string;
  /** Additional notes from the template's spec header (when present). */
  notes?: string[];
  /** Raw YAML source of the template (when retained by the parser). */
  rawYaml?: string;
}

/**
 * Internal cache shape produced by `ComponentFetcher.fetchCatalogData`. Mirrors
 * {@link GitLabCatalogData} but with each component already locally parsed (see
 * {@link ParsedCatalogComponent}).
 */
export interface ParsedCatalogData {
  /** Locally-parsed components found under `templates/`. */
  components: ParsedCatalogComponent[];
  /** YAML fragment files (no `spec` section) that contribute reusable anchors. */
  fragments?: GitLabYamlFragment[];
}
