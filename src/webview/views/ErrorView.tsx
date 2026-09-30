import { Page, PageAssets } from './Page';

export interface ErrorViewProps extends PageAssets {
  message: string;
  /** Present for an auth failure: the plain-language summary shown in place of the raw message. */
  authSummary?: string;
}

/**
 * The catch-all view shown when loading the Component Browser throws. An auth failure shows its summary with the raw
 * message behind a "Show details" toggle; anything else shows the message directly.
 *
 * @param props.message     The thrown error's message.
 * @param props.authSummary The plain-language summary, present only for an auth failure.
 * @returns                 The page element, for `renderDocument`.
 */
export function ErrorView({ message, authSummary, ...assets }: ErrorViewProps) {
  return (
    <Page title="GitLab CI/CD Components - Error" {...assets}>
      <h1>Component Loading Error</h1>

      <div class="error">
        {authSummary ? (
          <>
            {authSummary}{' '}
            <button class="link-button" data-action="toggleDetails" data-details-id="error-raw">Show details</button>
            <pre class="error-raw is-hidden" id="error-raw">{message}</pre>
          </>
        ) : (
          <>
            <strong>Error:</strong> {message}
          </>
        )}
      </div>

      <div>
        {authSummary && <button data-action="updateToken">Update Token</button>}{' '}
        <button data-action="refresh">Try Again</button>{' '}
        <button data-action="openSettings">Open Settings</button>
      </div>
    </Page>
  );
}
