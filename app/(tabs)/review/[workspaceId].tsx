import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/ui/primitives';
import { ReviewPanel } from '@/ui/ReviewPanel';

export default function ReviewWorkspace() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  return (
    <Screen title="Review changes">
      <ReviewPanel workspaceId={workspaceId} />
    </Screen>
  );
}
