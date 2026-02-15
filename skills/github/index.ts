import type { Skill } from '@hydraclaw/skills';

const githubSkill: Skill = {
  id: 'github',
  name: 'GitHub',
  description: 'Create issues, pull requests, review code, and manage GitHub repositories',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/github', description: 'GitHub operations' },
    { type: 'command', pattern: '/gh', description: 'GitHub shorthand' },
    { type: 'keyword', pattern: 'github,pull request,issue,repository,pr,merge', description: 'GitHub-related keywords' },
  ],

  tools: [
    {
      name: 'github_create_issue',
      description: 'Create a new issue in a GitHub repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body (markdown)' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply' },
          assignees: { type: 'array', items: { type: 'string' }, description: 'Usernames to assign' },
        },
        required: ['owner', 'repo', 'title'],
      },
      async handler(args) {
        const { owner, repo, title, body, labels, assignees } = args as {
          owner: string; repo: string; title: string; body?: string;
          labels?: string[]; assignees?: string[];
        };
        const token = process.env.GITHUB_TOKEN;
        if (!token) return 'Error: GITHUB_TOKEN environment variable is not set';

        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title, body, labels, assignees }),
        });

        if (!response.ok) {
          return `Error creating issue: ${response.status} ${await response.text()}`;
        }

        const issue = await response.json() as { html_url: string; number: number };
        return `Issue #${issue.number} created: ${issue.html_url}`;
      },
    },
    {
      name: 'github_create_pr',
      description: 'Create a pull request in a GitHub repository',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR description (markdown)' },
          head: { type: 'string', description: 'Branch containing changes' },
          base: { type: 'string', description: 'Branch to merge into' },
          draft: { type: 'boolean', description: 'Create as draft PR' },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
      },
      async handler(args) {
        const { owner, repo, title, body, head, base, draft } = args as {
          owner: string; repo: string; title: string; body?: string;
          head: string; base: string; draft?: boolean;
        };
        const token = process.env.GITHUB_TOKEN;
        if (!token) return 'Error: GITHUB_TOKEN environment variable is not set';

        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title, body, head, base, draft: draft ?? false }),
        });

        if (!response.ok) {
          return `Error creating PR: ${response.status} ${await response.text()}`;
        }

        const pr = await response.json() as { html_url: string; number: number };
        return `PR #${pr.number} created: ${pr.html_url}`;
      },
    },
    {
      name: 'github_list_repos',
      description: 'List repositories for a user or organization',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'User or organization name' },
          type: { type: 'string', enum: ['all', 'owner', 'member'], description: 'Filter by type' },
          sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'], description: 'Sort field' },
        },
        required: ['owner'],
      },
      async handler(args) {
        const { owner, type: repoType, sort } = args as { owner: string; type?: string; sort?: string };
        const token = process.env.GITHUB_TOKEN;
        if (!token) return 'Error: GITHUB_TOKEN environment variable is not set';

        const params = new URLSearchParams();
        if (repoType) params.set('type', repoType);
        if (sort) params.set('sort', sort);
        params.set('per_page', '30');

        const response = await fetch(`https://api.github.com/users/${owner}/repos?${params}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
          },
        });

        if (!response.ok) {
          return `Error listing repos: ${response.status} ${await response.text()}`;
        }

        const repos = await response.json() as { full_name: string; description: string; stargazers_count: number }[];
        return repos
          .map(r => `- ${r.full_name}: ${r.description ?? 'No description'} (${r.stargazers_count} stars)`)
          .join('\n');
      },
    },
    {
      name: 'github_review_pr',
      description: 'Submit a review on a pull request',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          pull_number: { type: 'number', description: 'Pull request number' },
          event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], description: 'Review action' },
          body: { type: 'string', description: 'Review body' },
        },
        required: ['owner', 'repo', 'pull_number', 'event'],
      },
      async handler(args) {
        const { owner, repo, pull_number, event, body } = args as {
          owner: string; repo: string; pull_number: number; event: string; body?: string;
        };
        const token = process.env.GITHUB_TOKEN;
        if (!token) return 'Error: GITHUB_TOKEN environment variable is not set';

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ event, body: body ?? '' }),
          }
        );

        if (!response.ok) {
          return `Error submitting review: ${response.status} ${await response.text()}`;
        }

        return `Review submitted (${event}) on PR #${pull_number}`;
      },
    },
  ],

  systemPromptAddition: 'You can manage GitHub repositories, create issues, create and review pull requests, and list repos using the GitHub skill tools.',

  async init(config) {
    if (!process.env.GITHUB_TOKEN && !config.token) {
      console.warn('[github-skill] No GITHUB_TOKEN found. GitHub operations will fail until one is provided.');
    }
  },
};

export default githubSkill;
