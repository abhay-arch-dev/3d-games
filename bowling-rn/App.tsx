import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import GameWebView from './src/screens/GameWebView';
import { startServer } from './src/server/startServer';

export type Mode = 'camera' | 'controller';

// Start the local game server as soon as the app loads.
startServer();

export default function App(): React.JSX.Element {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f1a" hidden={mode !== null} />
      {mode ? <GameWebView mode={mode} onExit={() => setMode(null)} /> : <HomeScreen onPick={setMode} />}
    </SafeAreaProvider>
  );
}
