import { Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Renders the in-sandbox Expo dev server. On web we use a native <iframe>
// because react-native-webview has no web target; on iOS/Android we use
// the real WebView.
export function SandboxPreview({ url }: { url: string }) {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.fill}>
        <iframe
          src={url}
          title="Expo preview"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </View>
    );
  }
  return (
    <WebView
      source={{ uri: url }}
      style={styles.fill}
      // Expo Metro UI relies on JS + cookies; keep both on by default.
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
