/**
 * Stylelint config for the webview stylesheets under src/webview/styles.
 *
 * @type {import('stylelint').Config}
 */
export default {
  extends: 'stylelint-config-standard',
  rules: {
    // VS Code's theme variables are camelCase after the component segment (`--vscode-textLink-foreground`). They are
    // read, never declared here, so the standard kebab-case rule has to admit them.
    'custom-property-pattern': '^vscode-[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$',
  },
};
