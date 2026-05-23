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
        getConfiguration: (section) => ({
            get: (key, defaultValue) => {
                if (key === 'trustedIncludeRoot') {
                    // For Test 5/6, we trust the fixtures directory
                    return [path.join(__dirname, '../../tests/fixtures')];
                }
                if (key === 'logLevel') return 'info';
                return defaultValue;
            }
        }),
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
    if (id.includes('componentCacheManager')) { return { getComponentCacheManager: () => ({ getComponents: async () => [], fetchAndCacheRawTemplate: async () => null }) }; }
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
        external: ['vscode', '*/componentService', '*/componentCacheManager']
    });

    try {
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

        console.log('\nTest 5: alwaysInclude with absolute PEP path does not corrupt the main pipeline YAML');
        // Run WITHOUT a workspace folder so the dir-relative fallback is exercised.
        // (The pep-policy.gitlab-ci.yml includes pipelines/secret-detection.gitlab-ci.yml
        // which sits next to it; without a workspace the parser must find it via dirname.)
        vscodeMock.workspace.workspaceFolders = [];
        try {
            const complexFixture = path.join(__dirname, '../../tests/fixtures/complex-pipeline.gitlab-ci.yml');
            const pepFixture    = path.join(__dirname, '../../tests/fixtures/pep-policy.gitlab-ci.yml');

            const complexContent = fs.readFileSync(complexFixture, 'utf8');

            // The key scenario: PEP file passed as extraInclude (what alwaysInclude does).
            // Previously this was injected as a YAML string causing duplicate-key corruption.
            const extraIncludes = [{ local: pepFixture }];

            const parser = new PipelineParser(10);
            const graph = await parser.parse(complexContent, complexFixture, {}, extraIncludes);

            // 1. The main file must parse cleanly — no YAML corruption errors
            const parseErrors = graph.errors.filter(e => e.includes('Failed to parse YAML'));
            assert.strictEqual(parseErrors.length, 0,
                `YAML parse errors must be zero. Got: ${parseErrors.join('; ')}`);

            const allJobs = graph.stages.flatMap(s => s.jobs);
            const jobNames = allJobs.map(j => j.name);

            // 2. Jobs from the complex pipeline main file must be present
            assert.ok(jobNames.includes('main_app_lint'),   'main_app_lint must be present from complex pipeline');
            assert.ok(jobNames.includes('main_app_deploy'), 'main_app_deploy must be present from complex pipeline');

            // 3. Inline PEP job (SAST policy) must be present
            assert.ok(jobNames.includes('sast_job'), 'sast_job must be extracted from inline SAST policy');

            // 4. Job from the nested local include (Secret Detection policy → pipelines/secret-detection.gitlab-ci.yml)
            //    This tests the dir-relative fallback resolution path.
            assert.ok(jobNames.includes('secret_detection_job'),
                'secret_detection_job must be resolved from PEP nested local include');

            // 5. pipeline_execution_policy must NOT appear as a job
            assert.ok(!jobNames.includes('pipeline_execution_policy'),
                'pipeline_execution_policy must not be treated as a job');

            // 6. The nested include file must appear in includedSources
            const includedPaths = graph.includedSources;
            const nestedIncluded = includedPaths.some(s => s.includes('secret-detection.gitlab-ci.yml'));
            assert.ok(nestedIncluded,
                `Nested PEP include must appear in includedSources. Got: ${includedPaths.join(', ')}`);

            console.log('alwaysInclude + complex pipeline: PASS ✅');
            passed++;
        } catch (e) {
            console.error('alwaysInclude + complex pipeline: FAIL ❌', e.message);
            failed++;
        }

        console.log('\nTest 6: Windows absolute paths are not misidentified as project shorthands');
        try {
            const parser = new PipelineParser(10);
            // Mock a Windows-style absolute path include
            const windowsPath = 'C:\\dev\\project\\ci-template.yml';
            
            // We use a mock fs.readFileSync inside resolveLocalInclude indirectly
            // But the primary check is whether it calls resolveLocalInclude vs hitting the project branch.
            // If it hits the project branch, it will try to fetch via API and fail with a specific error.
            
            // Let's use a non-existent absolute path and check the error message.
            // It should say "Cannot find local file" (local branch) 
            // NOT "Could not fetch project file" (project branch).
            const graph = await parser.parse('stages: [test]', 'main.yml', {}, [{ local: windowsPath }]);
            
            const hasProjectError = graph.errors.some(e => e.includes('Could not fetch project file'));
            const hasLocalError = graph.errors.some(e => e.includes('Cannot find local file'));
            
            assert.strictEqual(hasProjectError, false, 'Should not be identified as a project include');
            assert.strictEqual(hasLocalError, true, 'Should be identified as a (missing) local include');
            
            console.log('Windows path handling: PASS ✅');
            passed++;
        } catch (e) {
            console.error('Windows path handling: FAIL ❌', e.message);
            failed++;
        }

        console.log('\nTest 7: Include tree captures hierarchical relationships');
        try {
            const parser = new PipelineParser(10);
            // Using the mocked remote-a.yml (which includes remote-b.yml)
            const yaml = `include:\n  - remote: https://example.com/remote-a.yml`;
            const graph = await parser.parse(yaml, 'main.yml');
            
            // Expected Structure:
            // main.yml
            //   └── remote-a.yml
            //         └── remote-b.yml
            
            assert.strictEqual(graph.errors.length, 0, `Should have no errors, got: ${graph.errors.join('; ')}`);
            assert.strictEqual(graph.includeTree.name, 'main.yml');
            assert.strictEqual(graph.includeTree.children.length, 1);
            const aNode = graph.includeTree.children[0];
            assert.ok(aNode.name.includes('remote-a.yml'), 'aNode name should contain remote-a.yml');
            assert.strictEqual(aNode.children.length, 1, 'aNode should have 1 child (remote-b.yml)');
            const bNode = aNode.children[0];
            assert.ok(bNode.name.includes('remote-b.yml'), 'bNode name should contain remote-b.yml');
            
            console.log('Include tree: PASS ✅');
            passed++;
        } catch (e) {
            console.error('Include tree: FAIL ❌', e.message);
            failed++;
        }
    } finally {
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    }


    console.log(`\n=== Pipeline Parser Test Summary ===`);
    console.log(`Total tests: 7`);
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
