import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import GameWebView from './src/screens/GameWebView';
import { startServer } from './src/server/startServer';

import type { GameId } from './web/src/protocol';

export type Mode = 'camera' | 'controller';
export interface Pick { mode: Mode; game: Exclude<GameId, 'hub'> }

// Start the local game server as soon as the app loads.
startServer();

export default function App(): React.JSX.Element {
  const [pick, setPick] = useState<Pick | null>(null);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0b0f1a" hidden={pick !== null} />
      {pick ? <GameWebView pick={pick} onExit={() => setPick(null)} /> : <HomeScreen onPick={setPick} />}
    </SafeAreaProvider>
  );
}
