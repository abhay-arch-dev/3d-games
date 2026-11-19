import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Mode } from '../../App';
import { startServer } from '../server/startServer';
import type { ServerInfo } from '../../web/src/protocol';

interface Props { onPick: (mode: Mode) => void }

export default function HomeScreen({ onPick }: Props): React.JSX.Element {
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    const server = startServer();
    const refresh = () => { server.info().then(setInfo).catch(() => {}); };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  const tvUrl = info?.ips.length ? `http://${info.ips[0]}:${info.port}/tv` : null;

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>🎳 Motion Bowling</Text>
      <Text style={styles.sub}>Bowl with your body. No controller needed.</Text>

      <View style={styles.tvBox}>
        <Text style={styles.tvLbl}>On the TV, open a browser and go to</Text>
        <Text style={styles.tvUrl} selectable>{tvUrl ?? 'Connect this phone to Wi-Fi'}</Text>
        {info && (
          <Text style={styles.peers}>
            {info.peers.tv > 0 ? '🟢 TV connected' : '⚪ Waiting for the TV'}
          </Text>
        )}
      </View>

      <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => onPick('camera')}>
        <Text style={styles.cardTitle}>📷 Camera mode</Text>
        <Text style={styles.cardText}>Phone on a stand facing you. Step to aim, swing your arm to throw.</Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => onPick('controller')}>
        <Text style={styles.cardTitle}>📱 Motion mode</Text>
        <Text style={styles.cardText}>Hold the phone and swing it like the ball, or swipe.</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f1a', padding: 20, justifyContent: 'center' },
  title: { color: '#ffb03a', fontSize: 34, fontWeight: '900', textAlign: 'center' },
  sub: { color: '#9aa3c0', fontSize: 16, textAlign: 'center', marginTop: 6, marginBottom: 24 },
  tvBox: { backgroundColor: '#161c2e', borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#262e48' },
  tvLbl: { color: '#9aa3c0', textAlign: 'center' },
  tvUrl: { color: '#ffb03a', fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  peers: { color: '#c9d0e6', textAlign: 'center', marginTop: 8 },
  card: { backgroundColor: '#161c2e', borderRadius: 16, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#262e48' },
  pressed: { opacity: 0.7 },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  cardText: { color: '#9aa3c0', fontSize: 15, marginTop: 4 },
});
