/**
 * Builder for the public GitLab URL that points at a component's template file on the source project's web UI.
 *
 * The cache stores `templatePath` — the repo-relative path the fetcher landed on, e.g.
 * `templates/install-yu-ci-tools/template.yml` (directory form) or `templates/install-yu-ci-tools.yml` (single-file
 * form) — for every component populated via catalog discovery. {@link templateFileUrlForResolved} turns that into a
 * navigable GitLab URL whose shape depends on the layout:
 *
 *   - Single-file form (`templates/<name>.yml`, 2 segments): `/-/blob/<ref>/templates/<name>.yml` — the file itself.
 *   - Directory form (`templates/<name>/template.yml`, 3+ segments): `/-/tree/<ref>/templates/<name>` — the directory
 *     that contains the template plus any sibling files (README, fragments, etc.).
 *
 * The `<ref>` defaults to `main` when the component URL doesn't pin a version, and is URL-encoded so refs that contain
 * `/` (e.g. `feature/branch-name`) work.
 */

/**
 * URL-encode a ref so refs containing `/` (e.g. `feature/branch-name`) are safe to embed in a GitLab
 * `/-/blob/<ref>/...` or `/-/tree/<ref>/...` URL. An absent or `main` ref is returned literally so the link points at
 * the project's default branch view in the common case.
 *
 * @param version  The ref to encode, or `undefined` to default to `main`.
 * @returns        A URL-safe ref string suitable for direct interpolation into a GitLab ref-scoped URL.
 */
function ref(version: string | undefined): string {
  return version && version !== 'main' ? encodeURIComponent(version) : 'main';
}

/**
 * Build the path-and-route portion of a GitLab URL appropriate to the layout of the resolved template path:
 *
 * - Single-file form (`templates/<name>.yml`, 2 segments): `/-/blob/<ref>/templates/<name>.yml` — the file itself.
 * - Directory form (`templates/<name>/template.yml`, 3+ segments): `/-/tree/<ref>/templates/<name>` — the directory
 *   that contains the template plus any sibling files (README, fragments, etc.).
 *
 * @param templatePath  Repo-relative path of the template (file path, not directory). Must contain at least one `/`.
 * @param encodedRef    Already URL-encoded ref to embed in the URL.
 * @returns             The path portion starting with `/-/blob/...` or `/-/tree/...`, ready to append to the project
 *                      root URL.
 */
function pathForTemplate(templatePath: string, encodedRef: string): string {
  const segments = templatePath.split('/');
  if (segments.length <= 2) {
    return `/-/blob/${encodedRef}/${templatePath}`;
  }
  const directory = segments.slice(0, -1).join('/');
  return `/-/tree/${encodedRef}/${directory}`;
}

/**
 * Build a GitLab URL pointing at a component template whose on-repo path is already known. The shape of the URL
 * depends on the template's layout:
 *
 * - Single-file form (`templates/<name>.yml`): links to the file via `/-/blob/<ref>/<templatePath>`.
 * - Directory form (`templates/<name>/template.yml` or similar): links to the parent directory via
 *   `/-/tree/<ref>/templates/<name>` so the README, fragments, and template are all visible together.
 *
 * @param input                 Inputs describing the resolved template file.
 * @param input.gitlabInstance  GitLab host, e.g. `gitlab.com`. No protocol prefix.
 * @param input.projectPath     Source project path, e.g. `group/subgroup/project`.
 * @param input.version         Ref to pin the link to (branch, tag, or SHA). Defaults to `main` when absent.
 * @param input.templatePath    Repo-relative path of the template file as recorded by the fetcher, e.g.
 *                              `templates/install-yu-ci-tools/template.yml`.
 * @returns                     A fully-qualified GitLab URL — either a `/-/blob/` link to the file (single-file
 *                              form) or a `/-/tree/` link to the parent directory (directory form).
 *
 * @example
 *   templateFileUrlForResolved({
 *     gitlabInstance: 'gitlab.com',
 *     projectPath: 'group/project',
 *     version: 'v2.9.0',
 *     templatePath: 'templates/install-yu-ci-tools.yml',
 *   });
 *   // => 'https://gitlab.com/group/project/-/blob/v2.9.0/templates/install-yu-ci-tools.yml'
 *
 * @example
 *   templateFileUrlForResolved({
 *     gitlabInstance: 'gitlab.com',
 *     projectPath: 'group/project',
 *     version: 'v2.9.0',
 *     templatePath: 'templates/install-yu-ci-tools/template.yml',
 *   });
 *   // => 'https://gitlab.com/group/project/-/tree/v2.9.0/templates/install-yu-ci-tools'
 */
export function templateFileUrlForResolved(input: {
  gitlabInstance: string;
  projectPath: string;
  version?: string;
  templatePath: string;
}): string {
  return `https://${input.gitlabInstance}/${input.projectPath}${pathForTemplate(input.templatePath, ref(input.version))}`;
}
