import { Page, PageAssets } from './Page';

/**
 * The spinner shown while the Component Browser fetches its sources.
 *
 * @param assets The document's CSP source, nonce and stylesheet; this view has no client script.
 * @returns      The page element, for `renderDocument`.
 */
export function LoadingView(assets: PageAssets) {
  return (
    <Page title="GitLab CI/CD Components" {...assets}>
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading GitLab CI/CD components...</p>
      </div>
    </Page>
  );
}
