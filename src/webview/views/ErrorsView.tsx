import { Page, PageAssets } from './Page';

/** One failed source, with its message already classified by the builder. */
export interface SourceError {
  source: string;
  summary: string;
  raw: string;
}

export interface ErrorsViewProps extends PageAssets {
  errors: SourceError[];
  hasAuthError: boolean;
}

/**
 * The full-screen view shown when no components loaded but sources reported errors. Each source's raw message sits
 * behind a "Show details" toggle.
 *
 * @param props.errors       One entry per failed source, in display order.
 * @param props.hasAuthError Whether any source failed on its token, which adds an "Update Token" button.
 * @returns                  The page element, for `renderDocument`.
 */
export function ErrorsView({ errors, hasAuthError, ...assets }: ErrorsViewProps) {
  return (
    <Page title="GitLab CI/CD Components" {...assets}>
      <h1>Component Loading Errors</h1>

      <p>There were errors loading components from the configured sources:</p>

      <div class="errors">
        {errors.map(({ source, summary, raw }, index) => {
          const detailsId = `error-details-${index}`;
          return (
            <div class="error-item">
              <div class="error-source">{source}</div>
              <div class="error-summary">{summary}</div>
              <button class="link-button" data-action="toggleDetails" data-details-id={detailsId}>Show details</button>
              <pre class="error-raw is-hidden" id={detailsId}>{raw}</pre>
            </div>
          );
        })}
      </div>

      <div>
        {hasAuthError && <button data-action="updateToken">Update Token</button>}{' '}
        <button data-action="refresh">Try Again</button>{' '}
        <button data-action="openSettings">Open Settings</button>
      </div>
    </Page>
  );
}
