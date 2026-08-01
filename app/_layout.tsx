import React from 'react';
import { Link, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PdfExtractorProvider } from '@/services/pdf/PdfExtractorProvider';
import { SettingsProvider } from '@/services/settings/SettingsProvider';
import { useTheme } from '@/ui/theme';

function Navigator() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Screen
          name="index"
          options={{
            title: 'Biblioteca',
            headerRight: () => (
              <Link href="/settings" style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}>
                Ajustes
              </Link>
            ),
          }}
        />
        <Stack.Screen name="reader/[id]" options={{ title: 'Leitura' }} />
        <Stack.Screen name="settings" options={{ title: 'Ajustes', presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          {/* A WebView do pdf.js vive aqui para ser carregada uma única vez. */}
          <PdfExtractorProvider>
            <Navigator />
          </PdfExtractorProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
