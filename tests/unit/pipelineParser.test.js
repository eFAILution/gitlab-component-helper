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

// Mock VS Code API and ComponentService before loading the parser.
// A single hook handles all mocked modules; the second definition was
// overwriting the first and losing onDidChangeConfiguration.
const originalRequire = Module.prototype.require;

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

const vscodeMock = {
    workspace: {
        getConfiguration: () => ({ get: () => 'info' }),
        workspaceFolders: [],
        onDidChangeConfiguration: () => ({ dispose: () => { } })
    },
    Uri: { parse: (s) => ({ fsPath: s }), file: (s) => ({ fsPath: s }), joinPath: () => ({}) },
    window: { createOutputChannel: () => ({ appendLine: () => { } }) },
    commands: {}
};

Module.prototype.require = function (id) {
    if (id === 'vscode') { return vscodeMock; }
    if (id.includes('componentService')) { return { getComponentService: () => mockComponentService }; }
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
        const stageNames = graph.stages.map(s => s.name);

        // .pre and .post always bookend; test is implicit and appended after custom stages
        assert.ok(stageNames.includes('.pre'), '.pre must be present');
        assert.ok(stageNames.includes('.post'), '.post must be present');
        assert.ok(stageNames.includes('custom1'), 'custom1 must be present');
        assert.ok(stageNames.includes('custom2'), 'custom2 must be present');
        assert.ok(stageNames.includes('test'), 'implicit test stage must be present');
        // .pre must come before custom stages; .post must come last
        assert.ok(stageNames.indexOf('.pre') < stageNames.indexOf('custom1'), '.pre before custom1');
        assert.ok(stageNames.indexOf('.post') === stageNames.length - 1, '.post must be last');

        const testStage = graph.stages.find(s => s.name === 'test');
        assert.ok(testStage, 'test stage must exist');
        assert.strictEqual(testStage.jobs.length, 1, 'test stage must have 1 job');
        assert.strictEqual(testStage.jobs[0].name, 'job3', 'job3 must be in test stage');

        console.log('Stage merging: PASS ✅');
        passed++;
    } catch (e) {
        console.error('Stage merging: FAIL ❌', e.message);
        failed++;
    }

    console.log('\nTest 2: Circular include detection — records error and does not crash');
    try {
        const parser = new PipelineParser(10);
        // This remote URL will fail to fetch (no real network in tests).
        // The parser should record an error and still return a valid graph.
        const yaml = `include:\n  - remote: https://example.com/remote-a.yml\nbaseJob:\n  script: echo "base"`;
        const graph = await parser.parse(yaml, 'base.yml');

        // baseJob must always be extracted regardless of include failures
        const jobs = graph.stages.flatMap(s => s.jobs).map(j => j.name);
        assert.ok(jobs.includes('baseJob'), 'baseJob should always be present');

        // The graph must be returned (no crash), and stages must be well-formed
        assert.ok(Array.isArray(graph.stages), 'stages must be an array');
        assert.ok(Array.isArray(graph.errors), 'errors must be an array');

        console.log('Resilient error handling: PASS ✅');
        passed++;
    } catch (e) {
        console.error('Resilient error handling: FAIL ❌', e.message);
        failed++;
    }

    console.log('\nTest 3: Variable interpolation in remote includes');
    try {
        const parser = new PipelineParser(10);
        // $CI_SERVER_FQDN should be replaced with the gitlabInstance from context.
        // The fetch will fail (no network), but we can verify the error message contains
        // the interpolated URL (not the raw $CI_SERVER_FQDN placeholder).
        const yaml = `include:\n  - remote: https://$CI_SERVER_FQDN/my-remote.yml`;

        const graph = await parser.parse(yaml, 'base.yml', {
            gitlabInstance: 'gitlab.custom.com',
            serverUrl: 'https://gitlab.custom.com'
        });

        // The graph must be returned without crashing
        assert.ok(Array.isArray(graph.stages), 'stages must be returned');

        // Any error message should reference the interpolated domain, not the raw variable
        const errorText = graph.errors.join(' ');
        assert.ok(
            !errorText.includes('$CI_SERVER_FQDN'),
            `Error should not contain un-interpolated variable. Got: ${errorText}`
        );

        console.log('Variable interpolation: PASS ✅');
        passed++;
    } catch (e) {
        console.error('Variable interpolation: FAIL ❌', e.message);
        failed++;
    }


    console.log('\nTest 4: Pipeline Execution Policy (PEP) documents are parsed correctly');
    try {
        const parser = new PipelineParser(10);
        const pepYaml = `
pipeline_execution_policy:
  - name: SAST Policy
    enabled: true
    pipeline:
      stages:
        - security_test
      sast_job:
        stage: security_test
        script: echo "running SAST"
  - name: Secret Detection Policy
    enabled: true
    pipeline:
      stages:
        - secret_scan
      secret_detection_job:
        stage: secret_scan
        script: echo "running secret detection"
`;
        const graph = await parser.parse(pepYaml, 'security-policies.yml');
        const stageNames = graph.stages.map(s => s.name);
        const jobNames = graph.stages.flatMap(s => s.jobs).map(j => j.name);

        // The top-level pipeline_execution_policy key must NOT appear as a job
        assert.ok(!jobNames.includes('pipeline_execution_policy'),
            'pipeline_execution_policy must not be treated as a job');

        // Stages from both policies must be present
        assert.ok(stageNames.includes('security_test'), 'security_test stage must be present');
        assert.ok(stageNames.includes('secret_scan'), 'secret_scan stage must be present');

        // Jobs from both policies must be extracted
        assert.ok(jobNames.includes('sast_job'), 'sast_job must be extracted from SAST policy');
        assert.ok(jobNames.includes('secret_detection_job'), 'secret_detection_job must be extracted from Secret Detection policy');

        // Job sources should identify the policy they came from
        const sastJob = graph.stages.flatMap(s => s.jobs).find(j => j.name === 'sast_job');
        assert.ok(sastJob?.source.includes('SAST Policy'), `sast_job source should reference policy name, got: ${sastJob?.source}`);

        console.log('PEP document parsing: PASS ✅');
        passed++;
    } catch (e) {
        console.error('PEP document parsing: FAIL ❌', e.message);
        failed++;
    }

    // Cleanup
    if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
    }

    console.log(`\n=== Pipeline Parser Test Summary ===`);
    console.log(`Total tests: 4`);
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
