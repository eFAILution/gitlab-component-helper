import { Page, PageAssets } from './Page';

/** A string literal, so the `<pre>` keeps its line breaks and indentation. */
const EXAMPLE_CONFIG = `
  [
    {
      "name": "GitLab CI Examples",
      "path": "gitlab-org/gitlab-foss",
      "gitlabInstance": "gitlab.com"
    },
    {
      "name": "OpenTofu Components",
      "path": "components/opentofu",
      "gitlabInstance": "gitlab.com"
    },
    {
      "name": "Internal Components",
      "path": "your-group/your-project",
      "gitlabInstance": "gitlab.your-company.com"
    }
  ]`;

/**
 * The guidance shown when no component sources are configured.
 *
 * @param assets The document's CSP source, nonce, stylesheet and client script.
 * @returns      The page element, for `renderDocument`.
 */
export function NoSourcesView(assets: PageAssets) {
  return (
    <Page title="GitLab CI/CD Components" {...assets}>
      <h1>Configure Component Sources</h1>

      <div class="guidance">
        <p>No GitLab component sources are configured. Please add sources in your settings.</p>

        <p>
          Go to: <strong>Settings &gt; Extensions &gt; GitLab Component Helper &gt; Component Sources</strong>
        </p>

        <p>Example configuration:</p>
        <pre>{EXAMPLE_CONFIG}</pre>
      </div>

      <button data-action="openSettings">Open Settings</button>
    </Page>
  );
}
