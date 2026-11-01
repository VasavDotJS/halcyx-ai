import { utf8 } from '@/core/security/crypto';
import type { AgentTaskRequest, ChangeSet, SandboxChecks } from '@/core/types';
import { readTar } from '@/core/workspace/tar';

/**
 * The "handoff" contract between HALCYX and a hosted sandbox. The agent never pushes; it
 * leaves a change archive that HALCYX pulls into the encrypted on-device workspace.
 */
export const REPO_DIR = '/workspace/repo';

export const PREVIEW_MARKER = /HALCYX_PREVIEW_URL=(https:\/\/[^\s"'<>]+)/;

export function handoffCommand(baseSha: string, outDir: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    `cd ${REPO_DIR}`,
    `mkdir -p ${q(outDir)}`,
    `{ git diff -z --name-only --diff-filter=d ${baseSha}; git ls-files -z -o --exclude-standard; } > ${q(`${outDir}/files.lst`)}`,
    `tar --null --ignore-failed-read -cf ${q(`${outDir}/changes.tar`)} -T ${q(`${outDir}/files.lst`)}`,
    `git diff -z --name-only --diff-filter=D ${baseSha} > ${q(`${outDir}/deleted.txt`)}`,
  ].join(' && ');
}

export function agentRules(req: AgentTaskRequest, outDir: string): string {
  const destructive = req.approvalMode
    ? `- Before any destructive action (deleting files or directories, running database migrations, dropping data, rewriting git history) call the \`request_approval\` tool and wait for the answer. Do not proceed if it is denied.`
    : '';
  const commands = req.askBeforeCommands
    ? `- Before running ANY shell command, call \`request_approval\` with the exact command. Do not run it if denied.`
    : '';
  return [
    'You are a coding agent operated from the HALCYX mobile app. The user reviews your work on their phone.',
    `The repository ${req.repo.owner}/${req.repo.name} is checked out at ${REPO_DIR} (branch ${req.baseBranch}, commit ${req.baseSha}).`,
    'Rules:',
    `- First run: cd ${REPO_DIR} && git checkout --quiet ${req.baseSha}. Work only inside ${REPO_DIR}.`,
    '- Read AGENTS.md / CONTRIBUTING.md in the repository if present and follow them.',
    '- Never push, never force-push, never change git remotes, never commit secrets or .env files. HALCYX pushes after the user reviews.',
    '- Do not commit; leave your changes in the working tree.',
    '- Run the project linter and tests when they exist.',
    '- If you start a web dev server and expose it on a public HTTPS URL, print a line HALCYX_PREVIEW_URL=<url>.',
    destructive,
    commands,
    'When you are done, as your final steps:',
    `1. Write ${outDir}/summary.md: first line a Conventional Commit message (max 72 chars), blank line, then a short Markdown summary of what changed and why.`,
    `2. Write ${outDir}/checks.json as {"lint":{"status":"passed|failed|not_run","summary":"..."},"tests":{"status":"passed|failed|not_run","summary":"..."}}.`,
    `3. Run exactly: ${handoffCommand(req.baseSha, outDir)}`,
    req.instructions.trim() ? `\nProject instructions from the user:\n${req.instructions.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseSummary(md: string | null, fallbackTitle: string): { commitMessage: string; summary: string } {
  const text = (md ?? '').replace(/\r/g, '').trim();
  if (!text) return { commitMessage: `chore: ${fallbackTitle}`.slice(0, 72), summary: '' };
  const [first = '', ...rest] = text.split('\n');
  return { commitMessage: first.replace(/^#+\s*/, '').slice(0, 72), summary: rest.join('\n').trim() };
}

const NOT_RUN: SandboxChecks = { lint: { status: 'not_run', summary: '' }, tests: { status: 'not_run', summary: '' } };

export function parseChecks(json: string | null): SandboxChecks {
  if (!json) return NOT_RUN;
  try {
    const j = JSON.parse(json) as Partial<SandboxChecks>;
    const norm = (v: unknown) => {
      const o = (v ?? {}) as { status?: string; summary?: string };
      const status = o.status === 'passed' || o.status === 'failed' ? o.status : 'not_run';
      return { status, summary: String(o.summary ?? '').slice(0, 500) } as SandboxChecks['lint'];
    };
    return { lint: norm(j.lint), tests: norm(j.tests) };
  } catch {
    return NOT_RUN;
  }
}

/** Normalises sandbox paths and rejects anything escaping the repository. */
export function safeRepoPath(path: string): string | null {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p || p.split('/').some((seg) => seg === '..' || seg === '.git') || p.startsWith('.git/')) return null;
  return p;
}

export function buildChangeSet(input: {
  tar: Uint8Array | null;
  deleted: string | null;
  summary: string | null;
  checks: string | null;
  title: string;
}): ChangeSet {
  const files = input.tar
    ? readTar(input.tar).flatMap((e) => {
        const p = safeRepoPath(e.path);
        return p ? [{ path: p, bytes: e.bytes }] : [];
      })
    : [];
  const deleted = (input.deleted ?? '')
    .split('\0')
    .map((s) => safeRepoPath(s.trim()))
    .filter((p): p is string => !!p);
  const { commitMessage, summary } = parseSummary(input.summary, input.title);
  return { files, deleted, commitMessage, summary, checks: parseChecks(input.checks) };
}

export const decodeOrNull = (b: Uint8Array | null) => (b ? utf8.decode(b) : null);

export function findPreviewUrl(text: string): string | null {
  return PREVIEW_MARKER.exec(text)?.[1] ?? null;
}

export const APPROVAL_TOOL = {
  name: 'request_approval',
  description:
    'Ask the HALCYX user to approve an action before doing it. Required before destructive actions (and before every shell command when the user asked for that).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Short description of the action.' },
      command: { type: 'string', description: 'Exact command or file path involved, if any.' },
      reason: { type: 'string', description: 'Why it is needed.' },
    },
    required: ['action'],
  },
} as const;
