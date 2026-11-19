import React, { useEffect, useState } from 'react';
import { BackHandler, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Mode } from '../../App';
import { PORT } from '../server/GameServer';

interface Props { mode: Mode; onExit: () => void }

/** Shows the camera or controller page served by the in-app server. */
export default function GameWebView({ mode, onExit }: Props): React.JSX.Element {
  const [allowed, setAllowed] = useState(mode !== 'camera' || Platform.OS !== 'android');

  useEffect(() => {
    if (allowed) return;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then((r) => {
      if (r === PermissionsAndroid.RESULTS.GRANTED) setAllowed(true);
      else onExit();
    });
  }, [allowed, onExit]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onExit(); return true; });
    return () => sub.remove();
  }, [onExit]);

  if (!allowed) {
    return <View style={styles.wait}><Text style={styles.waitText}>Waiting for camera permission…</Text></View>;
  }

  // ?app=1 makes the camera page start straight away (permission is already granted).
  const uri = `http://localhost:${PORT}/${mode}${mode === 'camera' ? '?app=1' : ''}`;
  return (
    <WebView
      source={{ uri }}
      style={styles.web}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      keyboardDisplayRequiresUserAction={false}
      // The server may need a moment to bind the port on first launch.
      onError={() => setTimeout(() => setAllowed((a) => a), 500)}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0b0f1a' },
  wait: { flex: 1, backgroundColor: '#0b0f1a', alignItems: 'center', justifyContent: 'center' },
  waitText: { color: '#9aa3c0', fontSize: 16 },
});
