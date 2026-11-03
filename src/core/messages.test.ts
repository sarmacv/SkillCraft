import { HostMessage, WebviewMessage } from './messages';

describe('Messages', () => {
  it('should create a state message', () => {
    const stateMessage: HostMessage = {
      type: 'state',
      state: {
        hasProject: true,
        project: {
          name: 'Test Project',
          language: 'typescript',
          targets: ['target1'],
          buildMode: 'development',
          description: 'A test project',
        },
        workflow: {} as any,
        findings: [],
        readiness: {} as any,
        readinessChecklist: [],
        efficiencyScore: 100,
        budget: {} as any,
        portability: {},
        ghosts: [],
        coach: [],
        coachBusy: false,
        modelName: 'TestModel',
      },
    };
    expect(stateMessage.type).toBe('state');
    expect(stateMessage.state.hasProject).toBe(true);
  });

  it('should create a node test result message', () => {
    const nodeTestResultMessage: HostMessage = {
      type: 'nodeTestResult',
      nodeId: 'node1',
      ok: true,
      detail: 'Test passed',
    };
    expect(nodeTestResultMessage.type).toBe('nodeTestResult');
    expect(nodeTestResultMessage.nodeId).toBe('node1');
    expect(nodeTestResultMessage.ok).toBe(true);
  });

  it('should create a select message', () => {
    const selectMessage: HostMessage = {
      type: 'select',
      nodeId: 'node1',
    };
    expect(selectMessage.type).toBe('select');
    expect(selectMessage.nodeId).toBe('node1');
  });

  it('should create a ready message', () => {
    const readyMessage: WebviewMessage = {
      type: 'ready',
    };
    expect(readyMessage.type).toBe('ready');
  });

  it('should create a workflow message', () => {
    const workflowMessage: WebviewMessage = {
      type: 'workflow',
      workflow: {} as any,
    };
    expect(workflowMessage.type).toBe('workflow');
  });

  it('should create a config message', () => {
    const configMessage: WebviewMessage = {
      type: 'config',
      patch: {
        language: 'javascript',
        targets: ['target1'],
        buildMode: 'production',
      },
    };
    expect(configMessage.type).toBe('config');
    expect(configMessage.patch.language).toBe('javascript');
  });

  it('should create a command message', () => {
    const commandMessage: WebviewMessage = {
      type: 'command',
      command: 'build',
    };
    expect(commandMessage.type).toBe('command');
    expect(commandMessage.command).toBe('build');
  });

  it('should create a testNode message', () => {
    const testNodeMessage: WebviewMessage = {
      type: 'testNode',
      nodeId: 'node1',
    };
    expect(testNodeMessage.type).toBe('testNode');
    expect(testNodeMessage.nodeId).toBe('node1');
  });

  it('should create a proposal message', () => {
    const proposalMessage: WebviewMessage = {
      type: 'proposal',
      key: 'proposalKey',
      action: 'accept',
    };
    expect(proposalMessage.type).toBe('proposal');
    expect(proposalMessage.key).toBe('proposalKey');
    expect(proposalMessage.action).toBe('accept');
  });

  it('should create a coachAnswer message', () => {
    const coachAnswerMessage: WebviewMessage = {
      type: 'coachAnswer',
      id: 'question1',
      answer: 'Yes',
      decide: true,
      skip: false,
    };
    expect(coachAnswerMessage.type).toBe('coachAnswer');
    expect(coachAnswerMessage.id).toBe('question1');
  });

  it('should create an openFinding message', () => {
    const openFindingMessage: WebviewMessage = {
      type: 'openFinding',
      finding: {} as any,
    };
    expect(openFindingMessage.type).toBe('openFinding');
  });
});
