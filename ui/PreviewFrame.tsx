import { WebView } from 'react-native-webview';
import { useTheme } from './ThemeProvider';

/** Native in-app preview: HTTPS only, no popups, ephemeral storage. Remount (key) to reload. */
export function PreviewFrame({ url }: { url: string }) {
  const t = useTheme();
  return (
    <WebView
      source={{ uri: url }}
      originWhitelist={['https://*']}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      incognito
      style={{ flex: 1, backgroundColor: t.colors.bg }}
    />
  );
}
