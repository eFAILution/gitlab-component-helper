#!/usr/bin/env node
/**
 * Test script to verify the GitLab Component Description Fix
 * This script tests that component descriptions no longer incorrectly extract from non-existent spec.description fields
 */

const path = require('path');
const fs = require('fs');

// Import our componentService directly
const componentServicePath = path.join(__dirname, 'out', 'services', 'componentService.js');
if (!fs.existsSync(componentServicePath)) {
  console.error('❌ ERROR: Component service not found. Please run npm run compile first.');
  process.exit(1);
}

const { ComponentService } = require(componentServicePath);

// Mock VS Code dependencies
const vscode = {
  window: {
    showErrorMessage: (msg) => console.error('VSCODE ERROR:', msg),
    showInformationMessage: (msg) => console.info('VSCODE INFO:', msg),
  }
};

async function testDescriptionExtraction() {
  console.log('🧪 Testing GitLab Component Description Fix');
  console.log('==================================================\n');

  // Create a component service instance
  const componentService = new ComponentService();

  try {
    // Test the problematic component that was showing input descriptions
    console.log('Test 1: opentofu/full-pipeline component');
    console.log('------------------------------');

    const componentUrl = 'https://gitlab.com/components/opentofu/full-pipeline@2.6.1';
    console.log(`Testing URL: ${componentUrl}`);

    const component = await componentService.getComponent(componentUrl);

    console.log(`✅ Component name: ${component.name}`);
    console.log(`✅ Component description: ${component.description}`);
    console.log(`✅ Component parameters: ${component.parameters.length} found`);

    // Check if the description incorrectly contains input parameter descriptions
    const hasInputDescription = component.description.includes('Defines the validate stage');
    if (hasInputDescription) {
      console.log('❌ FAIL: Description still contains input parameter text');
      console.log('   This suggests the fix did not work properly.');
      return false;
    } else {
      console.log('✅ PASS: Description does not contain input parameter text');
      console.log('   The fix appears to be working correctly.');
    }

    // Show first few parameters for context
    if (component.parameters.length > 0) {
      console.log('\nFirst few parameters:');
      component.parameters.slice(0, 3).forEach(param => {
        console.log(`  - ${param.name}: ${param.description}`);
      });
    }

    return true;

  } catch (error) {
    console.error('❌ ERROR during testing:', error.message);
    return false;
  }
}

// Run the test
testDescriptionExtraction().then(success => {
  console.log('\n==================================================');
  if (success) {
    console.log('🎉 GitLab Component Description Fix Verification: PASSED');
    console.log('✅ Component descriptions no longer incorrectly extract from non-existent spec.description fields');
  } else {
    console.log('💥 GitLab Component Description Fix Verification: FAILED');
    process.exit(1);
  }
}).catch(error => {
  console.error('💥 Test execution failed:', error);
  process.exit(1);
});
