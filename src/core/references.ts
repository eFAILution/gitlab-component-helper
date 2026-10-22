/** Why a reference's GitLab variables couldn't be expanded. */
export type UnresolvedReason =
  /** The workspace's repository is hosted somewhere other than GitLab, so the variables have no meaning. */
  | { kind: 'non-gitlab-repo'; hostname: string; type: string }
  /** No GitLab remote and no configured component source to expand from. */
  | { kind: 'no-context' }
  /** Expansion ran but left variables the extension doesn't know how to expand. */
  | { kind: 'incomplete'; expandedUrl: string };

export type ResolvedReference =
  | { resolved: true; url: string }
  | { resolved: false; reason: UnresolvedReason };

/** Turns a `component:` value written in one document into a URL `new URL()` can parse. */
export type ReferenceResolver = (reference: string) => Promise<ResolvedReference>;
