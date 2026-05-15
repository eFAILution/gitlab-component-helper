/**
 * Pipeline Parser Unit Tests
 * 
 * Tests stage merging, circular includes, and URL interpolation.
 */

const assert = require('assert');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const Module = require('module');

console.log('=== Pipeline Parser Tests ===');

// Mock VS Code API before loading the parser
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return {
            workspace: { getConfiguration: () => ({ get: () => 'info' }), workspaceFolders: [], onDidChangeConfiguration: () => ({ dispose: () => { } }) },
            Uri: { parse: (s) => ({ fsPath: s }), file: (s) => ({ fsPath: s }), joinPath: () => ({}) },
            window: { createOutputChannel: () => ({ appendLine: () => { } }) },
            commands: {}
        };
    }
    return originalRequire.apply(this, arguments);
};

// Mock ComponentService
const mockComponentService = {
    httpClient: {
        fetchText: async (url) => {
            if (url.includes('remote-a.yml')) {
                return `include:\n  - remote: https://example.com/remote-b.yml\njobA:\n  script: echo "A"`;
            }
            if (url.includes('remote-b.yml')) {
                return `include:\n  - remote: https://example.com/remote-a.yml\njobB:\n  script: echo "B"`;
            }
            if (url.includes('my-remote.yml')) {
                return `jobRemote:\n  script: echo "remote"`;
            }
            return '';
        }
    }
};

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return {
            workspace: { getConfiguration: () => ({ get: () => 'info' }), workspaceFolders: [] },
            Uri: { parse: (s) => ({ fsPath: s }), file: (s) => ({ fsPath: s }), joinPath: () => ({}) },
            window: { createOutputChannel: () => ({ appendLine: () => { } }) },
            commands: {}
        };
    }
    if (id.includes('componentService')) {
        return { getComponentService: () => mockComponentService };
    }
    return originalRequire.apply(this, arguments);
};

async function runTests() {
    let passed = 0;
    let failed = 0;

    // Dynamically bundle the parser so we can require it in node without compiling the whole src dir
    const tempFile = path.join(__dirname, 'temp_pipelineParser.js');
    await esbuild.build({
        entryPoints: [path.join(__dirname, '../../src/parsers/pipelineParser.ts')],
        bundle: true,
        outfile: tempFile,
        format: 'cjs',
        platform: 'node',
        external: ['vscode']
    });

    const { PipelineParser } = originalRequire.apply(module, [tempFile]);

    console.log('\nTest 1: Stage merging works correctly and adds implicit stages');
    try {
        const parser = new PipelineParser(10);
        const yaml = `
stages:
  - custom1
  - custom2

job1:
  stage: custom1
  script: echo "custom1"

job2:
  stage: custom2
  script: echo "custom2"

job3:
  stage: test
  script: echo "implicit fallback"
`;
        const graph = await parser.parse(yaml, 'test.yml');
        const stages = graph.stages.map(s => s.name);

        assert.deepStrictEqual(stages, ['.pre', 'custom1', 'custom2', 'test', '.post']);

        const testStage = graph.stages.find(s => s.name === 'test');
        assert.ok(testStage);
        assert.strictEqual(testStage.jobs.length, 1);
        assert.strictEqual(testStage.jobs[0].name, 'job3');

        console.log('Stage merging: PASS ✅');
        passed++;
    } catch (e) {
        console.error('Stage merging: FAIL ❌', e);
        failed++;
    }

    console.log('\nTest 2: Circular include detection prevents infinite loops');
    try {
        const parser = new PipelineParser(10);
        const yaml = `include:\n  - remote: https://example.com/remote-a.yml\nbaseJob:\n  script: echo "base"`;
        const graph = await parser.parse(yaml, 'base.yml');

        const jobs = graph.stages.flatMap(s => s.jobs).map(j => j.name);

        assert.ok(jobs.includes('baseJob'), 'baseJob should be present');
        assert.ok(jobs.includes('jobA'), 'jobA should be included');
        assert.ok(jobs.includes('jobB'), 'jobB should be included');

        const maxDepthErrors = graph.errors.filter(e => e.includes('Max recursion depth'));
        assert.strictEqual(maxDepthErrors.length, 0, 'Circular include should have been detected before max depth');

        console.log('Circular include detection: PASS ✅');
        passed++;
    } catch (e) {
        console.error('Circular include detection: FAIL ❌', e);
        failed++;
    }

    console.log('\nTest 3: Include variable interpolation uses context');
    try {
        const parser = new PipelineParser(10);
        const yaml = `include:\n  - remote: https://$CI_SERVER_FQDN/my-remote.yml`;

        const graph = await parser.parse(yaml, 'base.yml', {
            gitlabInstance: 'gitlab.custom.com',
            serverUrl: 'https://gitlab.custom.com'
        });

        const jobs = graph.stages.flatMap(s => s.jobs).map(j => j.name);
        assert.ok(jobs.includes('jobRemote'), 'jobRemote should be present after interpolation');

        console.log('Variable interpolation: PASS ✅');
        passed++;
    } catch (e) {
        console.error('Variable interpolation: FAIL ❌', e);
        failed++;
    }

    // Cleanup
    if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
    }

    console.log(`\n=== Pipeline Parser Test Summary ===`);
    console.log(`Total tests: 3`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
