import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { FolderGit2, GitCompareArrows, MessageSquare, Settings } from 'lucide-react-native';
import { useWindowDimensions } from 'react-native';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useReadyServices } from '@/hooks/useServices';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/ThemeProvider';

export default function TabsLayout() {
  const t = useTheme();
  const s = useReadyServices();
  const session = useSession((x) => x.session);
  const { width } = useWindowDimensions();
  useKeyboardShortcuts();
  const pending = useQuery({ queryKey: ['workspaces'], queryFn: () => s.workspaces.listPending(), refetchInterval: 10_000 });
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  const count = pending.data?.filter((w) => w.status === 'ready' || w.status === 'needs_rebase').length ?? 0;
  const wide = width >= 900;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.fg,
        tabBarInactiveTintColor: t.colors.muted,
        tabBarStyle: { backgroundColor: t.colors.bg, borderTopColor: t.colors.hairline, borderTopWidth: 1 },
        tabBarLabelStyle: { fontFamily: t.font.medium, fontSize: 11 },
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarVariant: wide ? 'material' : 'uikit',
        tabBarLabelPosition: wide ? 'below-icon' : undefined,
        animation: t.reduceMotion ? 'none' : 'fade',
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{ title: 'Chat', tabBarIcon: ({ color, size }) => <MessageSquare color={color} size={size} strokeWidth={1.75} /> }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: 'Projects', tabBarIcon: ({ color, size }) => <FolderGit2 color={color} size={size} strokeWidth={1.75} /> }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: 'Review',
          tabBarBadge: count || undefined,
          tabBarBadgeStyle: { backgroundColor: t.colors.accent, color: t.colors.onAccent },
          tabBarIcon: ({ color, size }) => <GitCompareArrows color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Settings color={color} size={size} strokeWidth={1.75} /> }}
      />
    </Tabs>
  );
}
