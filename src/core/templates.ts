// Starter templates: working examples people can open and adapt.

import type { Workflow } from './types';
import { autoLayout, connect } from './workflow';

export interface Template {
  id: string;
  name: string;
  title: string;
  detail: string;
  workflow: Workflow;
}

const at = { x: 0, y: 0 };

export const TEMPLATES: Template[] = [
  {
    id: 'status-report',
    name: 'weekly-status-report',
    title: 'Weekly status report',
    detail: 'Jira API + Slack MCP → summarize → post to Slack and reply',
    workflow: autoLayout({
      version: 1,
      nodes: [
        { id: 'trigger', type: 'entry.trigger', label: 'Skill trigger', position: at, config: { does: 'Builds a weekly status report from Jira tickets and Slack discussions.', whenToUse: 'the user asks for a weekly status update, team report or sprint summary', examples: 'Write my weekly status update\nWhat did the platform team ship this week?' } },
        { id: 'inputs', type: 'entry.input', label: 'Inputs', position: at, config: { params: 'team: Jira project key, e.g. PLAT\nsince: Start date (YYYY-MM-DD), default 7 days ago' } },
        { id: 'jira', type: 'source.rest', label: 'Jira', position: at, config: { baseUrl: 'https://your-org.atlassian.net', path: '/rest/api/3/search', method: 'GET', query: '{"jql": "project = PLAT AND updated >= -7d"}', auth: 'bearer token', tokenEnv: 'JIRA_API_TOKEN' } },
        { id: 'slack', type: 'source.mcp', label: 'Slack', position: at, config: { server: 'slack', tool: 'search_messages', url: 'https://mcp.slack.com/mcp', usage: 'find this week\'s updates in the team channel' } },
        { id: 'fetch', type: 'module.script', label: 'Fetch tickets', position: at, config: { purpose: 'Fetch updated tickets and return id, title, status and assignee' } },
        { id: 'summarize', type: 'module.ai', label: 'Summarize', position: at, config: { instructions: 'Group the work into Shipped, In progress and Blocked. One line per item, most important first. Mention blockers by name.' } },
        { id: 'approve', type: 'module.approval', label: 'Confirm before posting', position: at, config: { question: 'Post this summary to Slack?' } },
        { id: 'post', type: 'output.message', label: 'Post to Slack', position: at, config: { channel: 'slack webhook', targetEnv: 'SLACK_WEBHOOK_URL' } },
        { id: 'reply', type: 'output.return', label: 'Reply in chat', position: at, config: { format: 'the summary as a bulleted list' } },
      ],
      edges: [connect('trigger', 'inputs'), connect('inputs', 'jira'), connect('inputs', 'slack'), connect('jira', 'fetch'), connect('fetch', 'summarize'), connect('slack', 'summarize'), connect('summarize', 'reply'), connect('summarize', 'approve'), connect('approve', 'post')],
    }),
  },
  {
    id: 'kb-answers',
    name: 'policy-answers',
    title: 'Answer from a knowledge base',
    detail: 'Knowledge base + local reference → cited answer',
    workflow: autoLayout({
      version: 1,
      nodes: [
        { id: 'trigger', type: 'entry.trigger', label: 'Skill trigger', position: at, config: { does: 'Answers questions about company policies with citations from the policy knowledge base.', whenToUse: 'the user asks about HR, travel, expense or security policies', examples: 'Can I expense a train upgrade?\nWhat is our remote work policy?' } },
        { id: 'kb', type: 'source.knowledge', label: 'Policy search', position: at, config: { endpoint: 'https://kb.example.com/search', topK: 5, auth: 'bearer token', tokenEnv: 'KB_API_TOKEN' } },
        { id: 'style', type: 'source.reference', label: 'Answer style guide', position: at, config: { file: 'references/answer-style.md', readWhen: 'writing the final answer' } },
        { id: 'empty', type: 'module.condition', label: 'Nothing found?', position: at, config: { rule: 'the search returns no relevant passages' } },
        { id: 'answer', type: 'module.ai', label: 'Answer with citations', position: at, config: { instructions: 'Answer in 2–4 sentences using only the retrieved passages. Cite each claim with the policy title. If passages disagree, say so.' } },
        { id: 'reply', type: 'output.return', label: 'Reply in chat', position: at, config: { format: 'a short answer followed by sources' } },
      ],
      edges: [connect('trigger', 'kb'), connect('kb', 'empty'), connect('empty', 'answer'), connect('style', 'answer'), connect('answer', 'reply')],
    }),
  },
  {
    id: 'pr-digest',
    name: 'pr-review-digest',
    title: 'Pull request digest',
    detail: 'GitHub CLI → risk check → markdown report file',
    workflow: autoLayout({
      version: 1,
      nodes: [
        { id: 'trigger', type: 'entry.trigger', label: 'Skill trigger', position: at, config: { does: 'Summarizes open pull requests and flags risky ones.', whenToUse: 'the user asks what PRs need review, or for a PR digest', examples: 'Which PRs need my review?\nGive me a PR digest for this repo' } },
        { id: 'gh', type: 'source.cli', label: 'Open PRs', position: at, config: { command: 'gh pr list --json number,title,author,additions,deletions,reviewDecision,url', requires: 'GitHub CLI (gh), signed in' } },
        { id: 'loop', type: 'module.loop', label: 'Each PR', position: at, config: { over: 'pull request' } },
        { id: 'risk', type: 'module.ai', label: 'Assess risk', position: at, config: { instructions: 'Flag a PR as risky if it is large (>500 lines), touches auth or payments, or has no review. Give a one-line reason.' } },
        { id: 'file', type: 'output.file', label: 'PR digest', position: at, config: { path: 'pr-digest.md' } },
        { id: 'reply', type: 'output.return', label: 'Reply in chat', position: at, config: { format: 'the top 3 PRs to review first' } },
      ],
      edges: [connect('trigger', 'gh'), connect('gh', 'loop'), connect('loop', 'risk'), connect('risk', 'file'), connect('risk', 'reply')],
    }),
  },
];
