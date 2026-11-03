import assert from 'node:assert/strict';
import { TargetId, ALL_TARGETS, ScriptLanguage, BuildMode, Category, ProjectConfig, TargetOverride, Workflow, WorkflowNode, WorkflowEdge, Severity, Finding, FileChange, WorkflowChange, Proposal, ProposalPriority, Readiness, ContextBudget, HealthReport } from '../src/core/types';

describe('Types module', () => {
  it('should have all target IDs defined', () => {
    assert.deepEqual(ALL_TARGETS, ['claude', 'codex', 'copilot']);
  });

  it('should define valid script languages', () => {
    const languages: ScriptLanguage[] = ['python', 'node', 'bash'];
    assert.deepEqual(languages, ['python', 'node', 'bash']);
  });

  it('should define valid build modes', () => {
    const modes: BuildMode[] = ['universal', 'tailored'];
    assert.deepEqual(modes, ['universal', 'tailored']);
  });

  it('should define valid categories', () => {
    const categories: Category[] = ['entry', 'source', 'module', 'output'];
    assert.deepEqual(categories, ['entry', 'source', 'module', 'output']);
  });

  it('should create a valid ProjectConfig object', () => {
    const projectConfig: ProjectConfig = {
      name: 'test-project',
      version: '1.0.0',
      skillPath: 'test-path',
      language: 'python',
      targets: ['claude'],
      buildMode: 'universal',
    };
    assert.equal(projectConfig.name, 'test-project');
    assert.equal(projectConfig.version, '1.0.0');
    assert.equal(projectConfig.skillPath, 'test-path');
    assert.equal(projectConfig.language, 'python');
    assert.deepEqual(projectConfig.targets, ['claude']);
    assert.equal(projectConfig.buildMode, 'universal');
  });

  it('should create a valid Workflow object', () => {
    const workflow: Workflow = {
      version: 1,
      nodes: [],
      edges: [],
    };
    assert.equal(workflow.version, 1);
    assert.deepEqual(workflow.nodes, []);
    assert.deepEqual(workflow.edges, []);
  });

  it('should create a valid Finding object', () => {
    const finding: Finding = {
      rule: 'test-rule',
      severity: 'error',
      area: 'structure',
      message: 'This is a test finding',
    };
    assert.equal(finding.rule, 'test-rule');
    assert.equal(finding.severity, 'error');
    assert.equal(finding.area, 'structure');
    assert.equal(finding.message, 'This is a test finding');
  });
});
