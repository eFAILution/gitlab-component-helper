/**
 * Client script shared by the per-source error list and the single fatal-error view.
 *
 * Both documents offer the same controls and differ only in how many errors they show, so they load one script.
 * Handlers are delegated from the document rather than bound with `onclick` attributes, which the document's
 * nonce-based CSP blocks.
 */

const vscode = acquireVsCodeApi();

/** Commands a button can post by naming them in `data-action`. */
const COMMANDS: Record<string, string> = {
  refresh: 'refreshComponents',
  openSettings: 'openSettings',
  updateToken: 'updateToken',
};

/**
 * Show or hide the raw error text a button points at via `data-details-id`, and flip its label.
 *
 * Toggles the `is-hidden` class rather than `style.display`: the document's CSP forbids `style` attributes, so
 * visibility is carried by the stylesheet.
 *
 * @param button    The clicked toggle, whose label is rewritten to match the new state.
 * @param detailsId Element id of the block to show or hide. A no-op if no such element exists.
 */
function toggleDetails(button: HTMLElement, detailsId: string): void {
  const details = document.getElementById(detailsId);
  if (!details) {
    return;
  }

  const hidden = details.classList.toggle('is-hidden');
  button.textContent = hidden ? 'Show details' : 'Hide details';
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLElement>('[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  if (action === 'toggleDetails') {
    const detailsId = button.dataset.detailsId;
    if (detailsId) {
      toggleDetails(button, detailsId);
    }
    return;
  }

  const command = action ? COMMANDS[action] : undefined;
  if (command) {
    vscode.postMessage({ command });
  }
});

export {};
