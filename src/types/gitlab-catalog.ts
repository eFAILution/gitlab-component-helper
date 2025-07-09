export interface GitLabCatalogComponent {
  name: string;
  description?: string;
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

export interface GitLabCatalogData {
  components: GitLabCatalogComponent[];
}
