import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink, QrCode, RotateCw } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { PreviewFrame } from '@/ui/PreviewFrame';
import { IconButton, Row, Sheet, Text } from '@/ui/primitives';

/** Live preview of the sandbox's web app, plus a QR code to open it on another device. */
export default function Preview() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [qr, setQr] = useState(false);
  const [nonce, setNonce] = useState(0);
  const safe = typeof url === 'string' && url.startsWith('https://') ? url : null;
  if (!safe) return <Text className="p-4">Preview URL must be HTTPS.</Text>;

  return (
    <View className="flex-1 bg-bg">
      <Row className="border-b-hairline border-hairline px-2 py-1">
        <Text variant="monoSmall" tone="muted" numberOfLines={1} className="flex-1 px-2">
          {safe}
        </Text>
        <IconButton icon={RotateCw} label="Reload" onPress={() => setNonce((n) => n + 1)} />
        <IconButton icon={QrCode} label="Show QR code" onPress={() => setQr(true)} />
        <IconButton icon={ExternalLink} label="Open in browser" onPress={() => void WebBrowser.openBrowserAsync(safe)} />
      </Row>
      <PreviewFrame key={nonce} url={safe} />
      <Sheet visible={qr} title="Open on another device" onClose={() => setQr(false)}>
        <View className="items-center gap-3 py-4">
          <View className="rounded-md bg-white p-4">
            <QRCode value={safe} size={200} />
          </View>
          <Text tone="muted" className="text-center">
            Scan with a phone or tablet camera.
          </Text>
        </View>
      </Sheet>
    </View>
  );
}
