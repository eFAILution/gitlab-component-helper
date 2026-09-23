/**
 * Stylelint config for the webview stylesheets under src/webview/styles.
 *
 * @type {import('stylelint').Config}
 */
export default {
  extends: 'stylelint-config-standard',
  rules: {
    // VS Code's theme variables are camelCase after the component segment (`--vscode-textLink-foreground`), and
    // stylelint checks this pattern against `var()` reads as well as declarations, so the standard kebab-case rule
    // has to admit them. Kept as an alternative rather than the whole pattern: requiring the `vscode-` prefix
    // outright would reject a property this project declares for itself (`--spacing-sm`), with a message
    // complaining about kebab-case on a name that is already kebab-case.
    'custom-property-pattern': '^(vscode-[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*|[a-z][a-z0-9]*(-[a-z0-9]+)*)$',
  },
};
