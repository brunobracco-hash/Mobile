import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DocumentRecord } from '@/core/library/types';
import { buildChunks, type TextChunk } from '@/core/text/chunk';
import { completionRatio, estimateRemainingSeconds, formatDuration } from '@/core/reading/progress';
import { SPEED_RANGE } from '@/core/settings/settings';
import { playbackController, usePlayback } from '@/services/player/usePlayback';
import { useSettings } from '@/services/settings/SettingsProvider';
import {
  getDocument,
  loadProgress,
  readDocumentText,
  saveDocument,
  touchDocument,
} from '@/services/storage/library';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '@/core/text/language';
import { Banner, Button, ProgressBar } from '@/ui/components';
import { radius, spacing, useTheme } from '@/ui/theme';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, update, loaded: settingsLoaded } = useSettings();
  const playback = usePlayback();

  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [chunks, setChunks] = useState<TextChunk[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const listRef = useRef<FlatList<TextChunk>>(null);
  const userScrolledRef = useRef(false);

  // Carrega o documento e restaura a posição de leitura.
  useEffect(() => {
    let cancelled = false;
    // Esperar os ajustes evita abrir a leitura com o motor errado e ter de
    // reiniciar a fila logo em seguida.
    if (!id || !settingsLoaded) return;

    (async () => {
      try {
        const record = await getDocument(id);
        if (!record) throw new Error('Documento não encontrado na biblioteca.');
        const text = await readDocumentText(id);
        const built = buildChunks(text);
        const progress = await loadProgress(id);
        if (cancelled) return;

        setDocument(record);
        setChunks(built);
        await playbackController.open(record, built, progress, settings);
        await touchDocument(id);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Não foi possível abrir o documento.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `settings` muda com frequência (velocidade, voz); a reabertura completa só
    // depende do documento. Mudanças posteriores chegam por `applySettings`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, settingsLoaded]);

  // Repassa mudanças de ajustes (voz, velocidade) para a leitura em andamento.
  useEffect(() => {
    if (!document) return;
    void playbackController.applySettings(settings);
  }, [document, settings]);

  // Acompanha o trecho atual, a menos que o usuário esteja lendo outro ponto.
  useEffect(() => {
    if (userScrolledRef.current || chunks.length === 0) return;
    if (playback.status !== 'playing') return;
    listRef.current?.scrollToIndex({
      index: Math.min(playback.chunkIndex, chunks.length - 1),
      animated: true,
      viewPosition: 0.35,
    });
  }, [chunks.length, playback.chunkIndex, playback.status]);

  const progressRatio = useMemo(() => {
    if (chunks.length === 0) return 0;
    return completionRatio(
      {
        documentId: id ?? '',
        chunkIndex: playback.chunkIndex,
        charOffset: chunks[playback.chunkIndex]?.start ?? 0,
        chunkFraction: playback.chunkFraction,
        updatedAt: Date.now(),
        completed: playback.status === 'finished',
      },
      chunks
    );
  }, [chunks, id, playback.chunkFraction, playback.chunkIndex, playback.status]);

  const remaining = useMemo(() => {
    if (chunks.length === 0) return 0;
    return estimateRemainingSeconds(
      {
        documentId: id ?? '',
        chunkIndex: playback.chunkIndex,
        charOffset: chunks[playback.chunkIndex]?.start ?? 0,
        chunkFraction: playback.chunkFraction,
        updatedAt: Date.now(),
        completed: false,
      },
      chunks,
      settings.speed
    );
  }, [chunks, id, playback.chunkFraction, playback.chunkIndex, settings.speed]);

  /**
   * O idioma decide a voz. A detecção automática acerta quase sempre, mas um
   * documento bilíngue ou com muitas citações pode precisar de correção.
   */
  const chooseLanguage = useCallback(() => {
    if (!document) return;
    Alert.alert(
      'Idioma do documento',
      'A voz da narração segue o idioma escolhido aqui.',
      [
        ...SUPPORTED_LANGUAGES.map((language) => ({
          text: `${LANGUAGE_LABELS[language]}${document.language === language ? ' ✓' : ''}`,
          onPress: () => {
            void (async () => {
              const updated = { ...document, language, languageAuto: false };
              await saveDocument(updated);
              setDocument(updated);
              const progress = await loadProgress(updated.id);
              await playbackController.close();
              await playbackController.open(updated, chunks, progress, settings);
            })();
          },
        })),
        { text: 'Cancelar', style: 'cancel' as const },
      ]
    );
  }, [chunks, document, settings]);

  const renderChunk = useCallback(
    ({ item }: ListRenderItemInfo<TextChunk>) => {
      const active = item.index === playback.chunkIndex;
      return (
        <Pressable
          onPress={() => void playbackController.goToChunk(item.index)}
          accessibilityRole="button"
          accessibilityLabel={`Ler a partir daqui: ${item.text.slice(0, 60)}`}
          style={[
            styles.chunk,
            active && { backgroundColor: theme.highlight, borderRadius: radius.sm },
          ]}>
          <Text
            style={[
              styles.chunkText,
              { color: active ? theme.text : theme.textMuted },
              active && styles.chunkTextActive,
            ]}>
            {item.text.trim()}
          </Text>
        </Pressable>
      );
    },
    [playback.chunkIndex, theme]
  );

  if (loadError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Banner tone="error">{loadError}</Banner>
      </View>
    );
  }

  if (!document) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const playLabel =
    playback.status === 'playing'
      ? 'Pausar'
      : playback.status === 'preparing'
        ? 'Preparando…'
        : playback.status === 'finished'
          ? 'Ouvir de novo'
          : 'Ouvir';

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: document.title,
          headerRight: () => (
            <Pressable onPress={chooseLanguage} accessibilityRole="button">
              <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '600' }}>
                {document.language === 'pt-BR' ? 'PT' : document.language === 'en-US' ? 'EN' : 'ES'}
              </Text>
            </Pressable>
          ),
        }}
      />

      <FlatList
        ref={listRef}
        data={chunks}
        keyExtractor={(chunk) => String(chunk.index)}
        renderItem={renderChunk}
        contentContainerStyle={styles.textContainer}
        onScrollBeginDrag={() => {
          userScrolledRef.current = true;
        }}
        onMomentumScrollEnd={() => {
          // Volta a acompanhar a narração quando o usuário para de arrastar.
          setTimeout(() => {
            userScrolledRef.current = false;
          }, 4000);
        }}
        // Sem altura fixa por item, o scrollToIndex pode falhar em textos longos.
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.35 });
          }, 120);
        }}
        initialNumToRender={20}
        windowSize={11}
      />

      <View
        style={[
          styles.controls,
          {
            backgroundColor: theme.surface,
            borderTopColor: theme.border,
            paddingBottom: insets.bottom + spacing.md,
          },
        ]}>
        {playback.message ? (
          <Banner tone={playback.status === 'error' ? 'error' : 'info'}>{playback.message}</Banner>
        ) : null}

        <ProgressBar value={progressRatio} />
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            Trecho {Math.min(playback.chunkIndex + 1, chunks.length)} de {chunks.length}
          </Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {playback.status === 'finished' ? 'Concluído' : `Faltam ${formatDuration(remaining)}`}
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <Button
            label="◀︎ 1"
            variant="secondary"
            onPress={() => void playbackController.skipChunks(-1)}
            style={styles.sideButton}
          />
          <Button
            label={playLabel}
            onPress={() => void playbackController.toggle()}
            loading={playback.status === 'preparing'}
            style={styles.playButton}
          />
          <Button
            label="1 ▶︎"
            variant="secondary"
            onPress={() => void playbackController.skipChunks(1)}
            style={styles.sideButton}
          />
        </View>

        <View style={styles.speedRow}>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            Velocidade {settings.speed.toFixed(2).replace('.', ',')}x
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={SPEED_RANGE.min}
            maximumValue={SPEED_RANGE.max}
            step={SPEED_RANGE.step}
            value={settings.speed}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
            onSlidingComplete={(value) => {
              void update({ speed: value });
            }}
          />
        </View>

        {playback.engine === 'device' ? (
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Voz do aparelho: a leitura pode parar quando o app sai da tela. Escolha uma voz de IA
            nos ajustes para ouvir com a tela apagada.
          </Text>
        ) : (
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            {playback.buffered > 0
              ? `${playback.buffered} ${playback.buffered === 1 ? 'trecho pronto' : 'trechos prontos'} à frente · controle a leitura pela tela bloqueada`
              : 'A leitura continua com a tela apagada e pode ser controlada pela tela bloqueada.'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  textContainer: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  chunk: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  chunkText: {
    fontSize: 18,
    lineHeight: 28,
  },
  chunkTextActive: {
    fontWeight: '600',
  },
  controls: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  sideButton: {
    width: 76,
  },
  playButton: {
    flex: 1,
  },
  speedRow: {
    gap: spacing.xs,
  },
  slider: {
    width: '100%',
    height: 36,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
  },
});
