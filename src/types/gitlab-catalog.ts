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
  default?: any;
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
