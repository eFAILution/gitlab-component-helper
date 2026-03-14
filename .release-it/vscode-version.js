const semver = require('semver');
const { Plugin } = require('release-it');

/**
 * VS Code Version Plugin for release-it
 *
 * Ensures version numbers follow VS Code's pre-release convention:
 * - ODD minor versions (0.7.x, 0.9.x, 0.11.x) = pre-release
 * - EVEN minor versions (0.8.x, 0.10.x, 0.12.x) = stable release
 */
class VSCodeVersionPlugin extends Plugin {
  constructor(...args) {
    super(...args);
    this.requireOddMinor = this.options.requireOddMinor || false;
    this.requireEvenMinor = this.options.requireEvenMinor || false;
  }

  /**
   * Get the next version based on VS Code's odd/even minor convention
   */
  getIncrementedVersionCI({ latestVersion, increment }) {
    const current = semver.parse(latestVersion);

    if (!current) {
      throw new Error(`Invalid version: ${latestVersion}`);
    }

    const currentMinor = current.minor;
    const isCurrentOdd = currentMinor % 2 === 1;
    const isCurrentEven = currentMinor % 2 === 0;

    this.log.info(`Current version: ${latestVersion} (minor: ${currentMinor}, ${isCurrentOdd ? 'odd' : 'even'})`);
    this.log.info(`Branch requirement: ${this.requireOddMinor ? 'odd minor' : this.requireEvenMinor ? 'even minor' : 'none'}`);
    this.log.info(`Increment type: ${increment}`);

    // Beta branch: must maintain odd minor
    if (this.requireOddMinor) {
      if (isCurrentEven) {
        // Current is even, bump to next odd minor
        const newVersion = `${current.major}.${currentMinor + 1}.0`;
        this.log.info(`✅ Bumping from EVEN minor to ODD: ${latestVersion} → ${newVersion}`);
        return newVersion;
      } else {
        // Current is odd, bump patch
        const newVersion = semver.inc(latestVersion, 'patch');
        this.log.info(`✅ Bumping patch on ODD minor: ${latestVersion} → ${newVersion}`);
        return newVersion;
      }
    }

    // Main branch: must maintain even minor
    if (this.requireEvenMinor) {
      if (isCurrentOdd) {
        // Current is odd, bump to next even minor
        const newVersion = `${current.major}.${currentMinor + 1}.0`;
        this.log.info(`✅ Bumping from ODD minor to EVEN: ${latestVersion} → ${newVersion}`);
        return newVersion;
      } else {
        // Current is even, use conventional increment
        let newVersion;
        if (increment === 'major') {
          newVersion = semver.inc(latestVersion, 'major');
        } else if (increment === 'minor') {
          newVersion = semver.inc(latestVersion, 'minor');
        } else {
          newVersion = semver.inc(latestVersion, 'patch');
        }
        this.log.info(`✅ Using conventional bump on EVEN minor: ${latestVersion} → ${newVersion} (${increment})`);
        return newVersion;
      }
    }

    // Fallback: standard semver bump
    const newVersion = semver.inc(latestVersion, increment || 'patch');
    this.log.info(`Using standard semver bump: ${latestVersion} → ${newVersion}`);
    return newVersion;
  }

  /**
   * Validate the calculated version meets requirements
   */
  beforeRelease() {
    const { version } = this.config.getContext();
    const parsed = semver.parse(version);

    if (!parsed) {
      throw new Error(`Invalid version: ${version}`);
    }

    const minor = parsed.minor;
    const isOdd = minor % 2 === 1;
    const isEven = minor % 2 === 0;

    // Validate odd requirement (beta branch)
    if (this.requireOddMinor && isEven) {
      throw new Error(
        `❌ Version ${version} has EVEN minor (${minor}), but beta branch requires ODD minor!\n` +
        `   VS Code treats even minors as stable releases.\n` +
        `   Expected: ${parsed.major}.${minor + 1}.x`
      );
    }

    // Validate even requirement (main branch)
    if (this.requireEvenMinor && isOdd) {
      throw new Error(
        `❌ Version ${version} has ODD minor (${minor}), but main branch requires EVEN minor!\n` +
        `   VS Code treats odd minors as pre-releases.\n` +
        `   Expected: ${parsed.major}.${minor + 1}.x`
      );
    }

    this.log.info(`✅ Version ${version} meets requirement (minor: ${minor}, ${isOdd ? 'odd' : 'even'})`);
  }
}

module.exports = VSCodeVersionPlugin;
