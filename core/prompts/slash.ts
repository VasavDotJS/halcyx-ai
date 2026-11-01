/** Slash commands expand into focused agent instructions. */
export type SlashCommand = { name: string; hint: string; expand: (rest: string) => string };

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/fix',
    hint: 'Find and fix a bug',
    expand: (r) =>
      `Find and fix this bug: ${r || 'the failing behaviour described in the issue'}. Add a regression test and run the test suite.`,
  },
  {
    name: '/test',
    hint: 'Write or improve tests',
    expand: (r) =>
      `Write or improve tests for ${r || 'the most critical untested code'}. Run the full test suite and fix any failures you introduced.`,
  },
  {
    name: '/explain',
    hint: 'Explain code without changing it',
    expand: (r) => `Explain how ${r || 'this repository'} works: architecture, key files and data flow. Do not modify any files.`,
  },
  {
    name: '/pr',
    hint: 'Polish changes for a pull request',
    expand: (r) =>
      `Prepare the work for a pull request: tidy the code, update docs and changelog if present, make lint and tests pass. ${r}`.trim(),
  },
];

export function expandSlash(input: string): string {
  const m = /^(\/\w+)\s*([\s\S]*)$/.exec(input.trim());
  if (!m) return input;
  const cmd = SLASH_COMMANDS.find((c) => c.name === m[1]);
  return cmd ? cmd.expand(m[2]!.trim()) : input;
}

export function matchSlash(input: string): SlashCommand[] {
  if (!input.startsWith('/') || input.includes(' ')) return [];
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(input));
}
