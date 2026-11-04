import { useSettings } from '@/state/settings';
import { Screen, Section, Segmented, Text, Toggle } from '@/ui/primitives';

const RETENTION = [
  { value: '1', label: '1h' },
  { value: '12', label: '12h' },
  { value: '24', label: '1d' },
  { value: '72', label: '3d' },
  { value: '168', label: '7d' },
];

export default function AgentBehaviour() {
  const s = useSettings();
  return (
    <Screen title="Agent behaviour">
      <Section
        title="Approval"
        footer="Claude enforces approvals in its runtime. Gemini is instructed to ask via a tool. Force-push is never possible: the sandbox only gets a read-only token."
      >
        <Toggle
          label="Approval mode"
          detail="Ask before deleting files, migrations or rewriting history"
          value={s.approvalMode}
          onChange={(v) => s.update({ approvalMode: v })}
        />
        <Toggle
          label="Ask before running commands"
          detail="Every shell command needs your OK"
          value={s.askBeforeCommands}
          onChange={(v) => s.update({ askBeforeCommands: v })}
          last
        />
      </Section>

      <Section
        title="Sandbox internet access"
        footer={
          s.agentNetwork === 'open'
            ? 'Unrestricted: a malicious file in the repository (README, comments, issues) could instruct the agent to upload your private code anywhere. Use only for repositories you trust.'
            : 'The agent can reach package registries and the repository host only. Code can’t be sent to other sites. GitHub access uses a read-only token for this one repository.'
        }
      >
        <Toggle
          label="Allow unrestricted internet"
          detail="Needed only if the build downloads from other sites"
          value={s.agentNetwork === 'open'}
          onChange={(v) => s.update({ agentNetwork: v ? 'open' : 'registries' })}
          last
        />
      </Section>

      <Text variant="label">Keep unpushed changes for</Text>
      <Segmented
        label="Retention"
        value={String(s.retentionHours)}
        onChange={(v) => s.update({ retentionHours: Number(v) })}
        options={RETENTION}
      />
      <Text variant="caption" tone="muted">
        Encrypted on this device until you push, or until this time passes (you’re warned 12 hours before). Then the copy is
        crypto-shredded.
      </Text>

      <Section title="Remote sandboxes">
        <Toggle
          label="Keep sandbox after push"
          detail="Off: HALCYX deletes the provider sandbox once your push is confirmed"
          value={s.keepSandboxAfterPush}
          onChange={(v) => s.update({ keepSandboxAfterPush: v })}
          last
        />
      </Section>
    </Screen>
  );
}
