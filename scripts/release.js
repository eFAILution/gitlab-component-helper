#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🚀 Starting local release process...\n');

function runCommand(command, description) {
  console.log(`📋 ${description}...`);
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'inherit'
    });
    console.log(`✅ ${description} completed\n`);
    return output;
  } catch (error) {
    console.error(`❌ ${description} failed:`, error.message);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim()) {
      console.log('❌ Working directory is not clean. Please commit your changes first.');
      console.log('Uncommitted changes:');
      console.log(status);
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to check git status:', error.message);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.error('❌ Failed to get current branch:', error.message);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

function main() {
  // Check if we're on the main branch
  const currentBranch = getCurrentBranch();
  if (currentBranch !== 'main') {
    console.log(`⚠️  You're on branch '${currentBranch}'. Releases should be made from 'main' branch.`);
    console.log('Continuing with current branch...\n');
  }

  // Check git status
  console.log('🔍 Checking git status...');
  checkGitStatus();
  console.log('✅ Working directory is clean\n');

  // Run tests
  runCommand('npm run test', 'Running tests');

  // Build and package
  runCommand('npm run package', 'Building and packaging extension');

  // Run semantic release
  console.log('🚀 Running semantic release...');
  runCommand('npm run semantic-release:local', 'Creating release');

  console.log('🎉 Release completed successfully!');
  console.log('📝 Check CHANGELOG.md for the updated changelog');
  console.log('🏷️  New git tag has been created');
  console.log('📦 Extension package (.vsix) is ready');
  console.log('🚀 GitHub release created (if token was available)');
}

if (require.main === module) {
  main();
}

module.exports = { runCommand, checkGitStatus, getCurrentBranch };
