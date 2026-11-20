import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Pick } from '../../App';
import { startServer } from '../server/startServer';
import { GAMES, type ServerInfo } from '../../web/src/protocol';

interface Props { onPick: (pick: Pick) => void }
type GameKey = Pick['game'];
const ORDER = Object.keys(GAMES) as GameKey[];

/** Game selection, then camera or motion mode for that game. */
export default function HomeScreen({ onPick }: Props): React.JSX.Element {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [game, setGame] = useState<GameKey | null>(null);

  useEffect(() => {
    const server = startServer();
    const refresh = () => { server.info().then(setInfo).catch(() => {}); };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  const tvUrl = info?.ips.length ? `http://${info.ips[0]}:${info.port}/tv` : null;

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <View style={styles.top}>
        <View>
          <Text style={styles.title}>Motion Games</Text>
          <Text style={styles.sub}>{game ? 'How do you want to play?' : 'Pick a game'}</Text>
        </View>
        <View style={styles.tvBox}>
          <Text style={styles.tvLbl}>TV browser address</Text>
          <Text style={styles.tvUrl} selectable>{tvUrl ?? 'Connect to Wi-Fi'}</Text>
          {info && <Text style={styles.peers}>{info.peers.tv > 0 ? '🟢 TV connected' : '⚪ Waiting for the TV'}</Text>}
        </View>
      </View>

      {!game ? (
        <ScrollView horizontal contentContainerStyle={styles.row} showsHorizontalScrollIndicator={false}>
          {ORDER.map((g) => (
            <Pressable key={g} style={({ pressed }) => [styles.game, pressed && styles.pressed]} onPress={() => setGame(g)}>
              <Text style={styles.icon}>{GAMES[g].icon}</Text>
              <Text style={styles.cardTitle}>{GAMES[g].name}</Text>
              <Text style={styles.cardText}>{GAMES[g].blurb}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.row}>
          <Pressable style={({ pressed }) => [styles.back, pressed && styles.pressed]} onPress={() => setGame(null)}>
            <Text style={styles.backTxt}>‹</Text>
            <Text style={styles.cardText}>Games</Text>
          </Pressable>
          <View style={styles.chosen}>
            <Text style={styles.icon}>{GAMES[game].icon}</Text>
            <Text style={styles.cardTitle}>{GAMES[game].name}</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.mode, pressed && styles.pressed]} onPress={() => onPick({ mode: 'camera', game })}>
            <Text style={styles.cardTitle}>📷 Camera mode</Text>
            <Text style={styles.cardText}>Phone on a stand facing you, 2–3 m back. Your body is the controller.</Text>
          </Pressable>
          {GAMES[game].motion && (
            <Pressable style={({ pressed }) => [styles.mode, pressed && styles.pressed]} onPress={() => onPick({ mode: 'controller', game })}>
              <Text style={styles.cardTitle}>📱 Motion mode</Text>
              <Text style={styles.cardText}>
                {game === 'runner' ? 'Hold the phone and swipe to move, jump and duck.' : 'Hold the phone and swing it, or swipe.'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f1a', paddingHorizontal: 20, paddingVertical: 14, justifyContent: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 16 },
  title: { color: '#ffb03a', fontSize: 30, fontWeight: '900' },
  sub: { color: '#9aa3c0', fontSize: 16, marginTop: 2 },
  tvBox: { backgroundColor: '#161c2e', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: '#262e48', alignItems: 'flex-end' },
  tvLbl: { color: '#9aa3c0', fontSize: 12 },
  tvUrl: { color: '#ffb03a', fontSize: 18, fontWeight: '800' },
  peers: { color: '#c9d0e6', fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'stretch' },
  game: { width: 190, backgroundColor: '#161c2e', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#262e48' },
  icon: { fontSize: 44, marginBottom: 6 },
  chosen: { width: 150, alignItems: 'center', justifyContent: 'center' },
  mode: { flex: 1, backgroundColor: '#161c2e', borderRadius: 18, padding: 18, borderWidth: 1, borderColor: '#262e48', justifyContent: 'center' },
  back: { width: 70, backgroundColor: '#161c2e', borderRadius: 18, borderWidth: 1, borderColor: '#262e48', alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: '#fff', fontSize: 36, fontWeight: '300' },
  pressed: { opacity: 0.7 },
  cardTitle: { color: '#fff', fontSize: 19, fontWeight: '800' },
  cardText: { color: '#9aa3c0', fontSize: 14, marginTop: 4 },
});
