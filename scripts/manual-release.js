#!/usr/bin/env node
/* eslint-env node */

const fs = require('fs');
const { execSync } = require('child_process');

// Check if this is a dry run
const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');

if (isDryRun) {
  console.log('� DRY RUN MODE - No changes will be made!\n');
} else {
  console.log('�🚀 Manual Release Script - No GitHub Actions Cost!\n');
}

// Helper function to run commands
function runCommand(command, description) {
  console.log(`📋 ${description}...`);
  if (isDryRun) {
    console.log(`   [DRY RUN] Would run: ${command}`);
    console.log(`✅ ${description} (dry run)\n`);
    return '';
  }
  try {
    const output = execSync(command, { encoding: 'utf8', stdio: 'inherit' });
    console.log(`✅ ${description} completed\n`);
    return output;
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    process.exit(1); // eslint-disable-line no-process-exit
  }
}

// Check git status
function checkGitStatus() {
  if (isDryRun) {
    console.log('[DRY RUN] Would check git status...');
    return;
  }
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim()) {
      console.log('❌ Working directory is not clean. Please commit your changes first.');
      console.log('Uncommitted changes:');
      console.log(status);
      process.exit(1); // eslint-disable-line no-process-exit
    }
  } catch (error) {
    console.error('❌ Failed to check git status:', error.message);
    process.exit(1); // eslint-disable-line no-process-exit
  }
}

// Get commits since last tag
function getCommitsSinceLastTag() {
  try {
    const lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    const commits = execSync(`git log ${lastTag}..HEAD --oneline --pretty=format:"%s"`, { encoding: 'utf8' });
    return commits.trim().split('\n').filter(commit => commit.length > 0);
  } catch (error) {
    // No previous tags, get all commits
    const commits = execSync('git log --oneline --pretty=format:"%s"', { encoding: 'utf8' });
    return commits.trim().split('\n').filter(commit => commit.length > 0);
  }
}

// Determine version bump from commits
function determineVersionBump(commits) {
  let hasBreaking = false;
  let hasFeature = false;
  let hasFix = false;

  for (const commit of commits) {
    if (commit.includes('!:') || commit.includes('BREAKING CHANGE')) {
      hasBreaking = true;
    } else if (commit.startsWith('feat:') || commit.startsWith('feat(')) {
      hasFeature = true;
    } else if (commit.startsWith('fix:') || commit.startsWith('fix(')) {
      hasFix = true;
    }
  }

  if (hasBreaking) return 'major';
  if (hasFeature) return 'minor';
  if (hasFix) return 'patch';
  return null; // No release needed
}

// Bump version in package.json
function bumpVersion(currentVersion, bumpType) {
  const parts = currentVersion.split('.').map(Number);

  switch (bumpType) {
    case 'major':
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case 'minor':
      parts[1]++;
      parts[2] = 0;
      break;
    case 'patch':
      parts[2]++;
      break;
  }

  return parts.join('.');
}

// Update changelog
function updateChangelog(version, commits) {
  if (isDryRun) {
    console.log(`[DRY RUN] Would update CHANGELOG.md with version ${version}`);
    console.log('[DRY RUN] Release notes would include:');

    const features = commits.filter(c => c.startsWith('feat:') || c.startsWith('feat('));
    const fixes = commits.filter(c => c.startsWith('fix:') || c.startsWith('fix('));
    const breaking = commits.filter(c => c.includes('!:') || c.includes('BREAKING CHANGE'));

    if (breaking.length > 0) {
      console.log('  ⚠ BREAKING CHANGES:');
      breaking.forEach(commit => console.log(`    - ${commit}`));
    }
    if (features.length > 0) {
      console.log('  ✨ Features:');
      features.forEach(commit => console.log(`    - ${commit}`));
    }
    if (fixes.length > 0) {
      console.log('  🐛 Bug Fixes:');
      fixes.forEach(commit => console.log(`    - ${commit}`));
    }
    return '';
  }

  const today = new Date().toISOString().split('T')[0];
  let changelogContent = '';

  if (fs.existsSync('CHANGELOG.md')) {
    changelogContent = fs.readFileSync('CHANGELOG.md', 'utf8');
  } else {
    changelogContent = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n';
  }

  // Add new release section
  const newSection = `## [${version}] - ${today}\n\n`;

  // Categorize commits
  const features = commits.filter(c => c.startsWith('feat:') || c.startsWith('feat('));
  const fixes = commits.filter(c => c.startsWith('fix:') || c.startsWith('fix('));
  const breaking = commits.filter(c => c.includes('!:') || c.includes('BREAKING CHANGE'));
  const others = commits.filter(c =>
    !c.startsWith('feat:') && !c.startsWith('feat(') &&
    !c.startsWith('fix:') && !c.startsWith('fix(') &&
    !c.includes('!:') && !c.includes('BREAKING CHANGE')
  );

  let releaseNotes = newSection;

  if (breaking.length > 0) {
    releaseNotes += '### ⚠ BREAKING CHANGES\n\n';
    breaking.forEach(commit => {
      releaseNotes += `- ${commit}\n`;
    });
    releaseNotes += '\n';
  }

  if (features.length > 0) {
    releaseNotes += '### ✨ Features\n\n';
    features.forEach(commit => {
      releaseNotes += `- ${commit}\n`;
    });
    releaseNotes += '\n';
  }

  if (fixes.length > 0) {
    releaseNotes += '### 🐛 Bug Fixes\n\n';
    fixes.forEach(commit => {
      releaseNotes += `- ${commit}\n`;
    });
    releaseNotes += '\n';
  }

  if (others.length > 0) {
    releaseNotes += '### 🔧 Other Changes\n\n';
    others.forEach(commit => {
      releaseNotes += `- ${commit}\n`;
    });
    releaseNotes += '\n';
  }

  // Insert after header
  const lines = changelogContent.split('\n');
  const headerEnd = lines.findIndex(line => line.includes('## [Unreleased]')) ||
                   lines.findIndex(line => line.includes('## [')) ||
                   lines.findIndex(line => line.trim() === '') + 1;

  lines.splice(Math.max(headerEnd, 3), 0, releaseNotes);

  fs.writeFileSync('CHANGELOG.md', lines.join('\n'));
  return releaseNotes;
}

function main() {
  console.log('🔍 Checking git status...');
  checkGitStatus();
  console.log('✅ Working directory is clean\n');

  console.log('📝 Analyzing commits...');
  const commits = getCommitsSinceLastTag();

  if (commits.length === 0) {
    console.log('ℹ️  No commits found since last release. Nothing to release.');
    return;
  }

  console.log(`Found ${commits.length} commits:`);
  commits.forEach(commit => console.log(`  - ${commit}`));
  console.log();

  const bumpType = determineVersionBump(commits);

  if (!bumpType) {
    console.log('ℹ️  No conventional commits found that warrant a release.');
    console.log('   Use feat:, fix:, or breaking changes to trigger releases.');
    return;
  }

  // Read current version
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const currentVersion = packageJson.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`📈 Version bump: ${currentVersion} → ${newVersion} (${bumpType})\n`);

  // Run tests
  runCommand('npm run test', 'Running tests');

  // Build and package
  runCommand('npm run package', 'Building and packaging extension');

  // Update package.json
  console.log('📝 Updating package.json...');
  if (isDryRun) {
    console.log(`[DRY RUN] Would update package.json version from ${currentVersion} to ${newVersion}`);
    console.log('[DRY RUN] Would run: npm install --package-lock-only');
  } else {
    packageJson.version = newVersion;
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');

    // Update package-lock.json to match the new version
    runCommand('npm install --package-lock-only', 'Updating package-lock.json');
  }
  console.log('✅ package.json updated\n');

  // Update changelog
  console.log('📝 Updating CHANGELOG.md...');
  updateChangelog(newVersion, commits);
  console.log('✅ CHANGELOG.md updated\n');

  // Git operations
  if (isDryRun) {
    console.log('[DRY RUN] Would run git commands:');
    console.log('  git add package.json package-lock.json CHANGELOG.md');
    console.log(`  git commit -m "chore(release): ${newVersion} [skip ci]"`);
    console.log(`  git tag ${newVersion}`);
  } else {
    runCommand(`git add package.json package-lock.json CHANGELOG.md`, 'Staging changes');
    runCommand(`git commit -m "chore(release): ${newVersion} [skip ci]"`, 'Committing release');
    runCommand(`git tag ${newVersion}`, 'Creating git tag');
  }

  if (isDryRun) {
    console.log('\n🔍 DRY RUN SUMMARY:');
    console.log(`🏷️  Would create tag: ${newVersion}`);
    console.log('📝 Would update CHANGELOG.md');
    console.log('📦 Would update package.json and package-lock.json');
    console.log('📦 Would build extension package (.vsix)');
    console.log('\n💡 To actually perform the release:');
    console.log('   npm run release:manual');
  } else {
    console.log('🎉 Release completed successfully!');
    console.log(`🏷️  Created tag: ${newVersion}`);
    console.log('📝 Updated CHANGELOG.md');
    console.log('📦 Updated package.json and package-lock.json');
    console.log('📦 Extension package (.vsix) is ready');
    console.log('\n💡 To push to remote:');
    console.log(`   git push origin main ${newVersion}`);
    console.log('\n💡 To create GitHub release manually:');
    console.log(`   gh release create ${newVersion} *.vsix --title "${newVersion}" --notes-from-tag`);
  }
}

if (require.main === module) {
  main();
}
