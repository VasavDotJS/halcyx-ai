import { router } from 'expo-router';
import {
  Bell,
  BookMarked,
  Bot,
  Gauge,
  HardDrive,
  History,
  KeyRound,
  Palette,
  Shield,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react-native';
import { ListRow, Screen, Section, Text } from '@/ui/primitives';
import { Logo } from '@/ui/Logo';
import Constants from 'expo-constants';
import { View } from 'react-native';

const go = (path: string) => () => router.push(path as never);

export default function SettingsHome() {
  return (
    <Screen title="Settings">
      <Section title="Agents">
        <ListRow
          icon={KeyRound}
          label="API keys"
          detail="Gemini, Claude, OpenAI · stored on this device"
          onPress={go('/(tabs)/settings/keys')}
        />
        <ListRow icon={Bot} label="Agent behaviour" detail="Approval mode, retention, sandboxes" onPress={go('/(tabs)/settings/agent')} />
        <ListRow icon={Gauge} label="Usage & cost" detail="Spend, budgets and hard cap" onPress={go('/(tabs)/settings/usage')} />
        <ListRow icon={BookMarked} label="Prompt library" onPress={go('/(tabs)/settings/prompts')} last />
      </Section>
      <Section title="App">
        <ListRow icon={Palette} label="Appearance" detail="Themes, accent, haptics" onPress={go('/(tabs)/settings/appearance')} />
        <ListRow icon={Shield} label="Security" detail="Biometric lock and auto-lock" onPress={go('/(tabs)/settings/security')} />
        <ListRow icon={Bell} label="Notifications" onPress={go('/(tabs)/settings/notifications')} />
        <ListRow icon={HardDrive} label="Storage cleaner" detail="Reclaim dependency caches" onPress={go('/(tabs)/settings/storage')} />
        <ListRow icon={History} label="Task history" onPress={go('/(tabs)/settings/history')} last />
      </Section>
      <Section title="Account">
        <ListRow
          icon={ShieldCheck}
          label="Privacy dashboard"
          detail="What’s stored where · wipe local data"
          onPress={go('/(tabs)/settings/privacy')}
        />
        <ListRow icon={Smartphone} label="Devices & sessions" onPress={go('/(tabs)/settings/devices')} />
        <ListRow icon={UserRound} label="Account" onPress={go('/(tabs)/settings/account')} last />
      </Section>
      <View className="items-center gap-2 py-6">
        <Logo height={16} />
        <Text variant="caption" tone="muted">
          Version {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </View>
    </Screen>
  );
}
