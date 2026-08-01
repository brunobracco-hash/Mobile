import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DocumentRecord, ImportStage, ReadingProgress } from '@/core/library/types';
import { LANGUAGE_LABELS } from '@/core/text/language';
import { estimateSeconds } from '@/core/text/chunk';
import { formatDuration } from '@/core/reading/progress';
import { getProvider } from '@/core/tts/registry';
import { importDocument } from '@/services/library/importDocument';
import { PdfExtractionError, usePdfExtractor } from '@/services/pdf/PdfExtractorProvider';
import { deleteDocument, listDocuments, loadProgress } from '@/services/storage/library';
import { getApiKey } from '@/services/storage/secrets';
import { useSettings } from '@/services/settings/SettingsProvider';
import { Banner, Button, EmptyState, ProgressBar } from '@/ui/components';
import { radius, spacing, useTheme } from '@/ui/theme';

interface Row {
  document: DocumentRecord;
  progress: ReadingProgress;
}

function describeStage(stage: ImportStage): string {
  switch (stage.kind) {
    case 'copying':
      return 'Copiando o arquivo…';
    case 'extracting':
      return `Extraindo o texto — página ${stage.page} de ${stage.pages}`;
    case 'analyzing':
      return 'Preparando o texto para a narração…';
    case 'done':
      return 'Pronto!';
  }
}

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const extractor = usePdfExtractor();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingApiKey, setMissingApiKey] = useState(false);

  const refresh = useCallback(async () => {
    const documents = await listDocuments();
    const withProgress = await Promise.all(
      documents.map(async (document) => ({
        document,
        progress: await loadProgress(document.id),
      }))
    );
    setRows(withProgress);
    setLoading(false);
  }, []);

  // O aviso de chave ausente só faz sentido quando ela realmente não está lá.
  // A chave é gravada em outra tela, então a verificação precisa acontecer a
  // cada vez que a biblioteca volta ao foco — e não só quando o provedor muda.
  const checkApiKey = useCallback(async () => {
    const provider = getProvider(settings.providerId);
    if (!provider.requiresApiKey) {
      setMissingApiKey(false);
      return;
    }
    const key = await getApiKey(provider.id);
    setMissingApiKey(!key);
  }, [settings.providerId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void checkApiKey();
    }, [checkApiKey, refresh])
  );

  const provider = getProvider(settings.providerId);

  const handleImport = useCallback(async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    if (!asset) return;

    setStage({ kind: 'copying' });
    try {
      const record = await importDocument(
        { uri: asset.uri, fileName: asset.name, onStage: setStage },
        extractor.extract
      );
      await refresh();
      router.push({ pathname: '/reader/[id]', params: { id: record.id } });
    } catch (caught) {
      setError(
        caught instanceof PdfExtractionError || caught instanceof Error
          ? caught.message
          : 'Não foi possível importar este PDF.'
      );
    } finally {
      setStage(null);
    }
  }, [extractor.extract, refresh, router]);

  const confirmDelete = useCallback(
    (document: DocumentRecord) => {
      Alert.alert(
        'Remover documento',
        `“${document.title}” e o progresso de leitura serão apagados do aparelho.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Remover',
            style: 'destructive',
            onPress: () => {
              void deleteDocument(document.id).then(refresh);
            },
          },
        ]
      );
    },
    [refresh]
  );

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Button
          label={stage ? describeStage(stage) : 'Importar um PDF'}
          onPress={() => void handleImport()}
          loading={Boolean(stage)}
        />
        {error ? <Banner tone="error">{error}</Banner> : null}
        {provider.requiresApiKey && missingApiKey ? (
          <Link href="/settings" asChild>
            <Pressable>
              <Banner tone="info">
                Voz atual: {provider.name}, mas não há chave de API salva. Toque para
                configurá-la — sem ela a leitura não começa.
              </Banner>
            </Pressable>
          </Link>
        ) : null}
        {provider.id === 'device' ? (
          <Link href="/settings" asChild>
            <Pressable>
              <Banner tone="info">
                Você está usando a voz do próprio aparelho. Ela funciona offline, mas soa menos
                natural e, no iOS, para quando o app sai da tela. Toque para escolher uma voz de IA.
              </Banner>
            </Pressable>
          </Link>
        ) : null}
      </View>
    ),
    [error, handleImport, missingApiKey, provider, stage]
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
      data={rows}
      keyExtractor={(row) => row.document.id}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={theme.accent} />
      }
      ListEmptyComponent={
        <EmptyState
          title="Sua biblioteca está vazia"
          description="Importe um PDF para começar a ouvi-lo. O texto é extraído no próprio aparelho e a leitura continua de onde você parou."
        />
      }
      renderItem={({ item }) => (
        <DocumentRow row={item} onDelete={() => confirmDelete(item.document)} speed={settings.speed} />
      )}
    />
  );
}

function DocumentRow({
  row,
  onDelete,
  speed,
}: {
  row: Row;
  onDelete: () => void;
  speed: number;
}) {
  const theme = useTheme();
  const { document, progress } = row;

  // Estimativa a partir do índice do trecho: evita carregar o texto inteiro
  // só para desenhar a lista.
  const ratio =
    document.chunkCount > 0
      ? Math.min(1, (progress.chunkIndex + progress.chunkFraction) / document.chunkCount)
      : 0;
  const remaining = estimateSeconds(document.chars * (1 - ratio), speed);

  return (
    <Link href={{ pathname: '/reader/[id]', params: { id: document.id } }} asChild>
      <Pressable
        onLongPress={onDelete}
        accessibilityRole="button"
        accessibilityHint="Toque e segure para remover"
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}>
        <Text numberOfLines={2} style={[styles.rowTitle, { color: theme.text }]}>
          {document.title}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textMuted }]}>
          {document.pages} {document.pages === 1 ? 'página' : 'páginas'} ·{' '}
          {LANGUAGE_LABELS[document.language]}
          {progress.completed ? ' · concluído' : ` · faltam ${formatDuration(remaining)}`}
        </Text>
        <View style={styles.rowProgress}>
          <ProgressBar value={progress.completed ? 1 : ratio} />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.xs,
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  rowMeta: {
    fontSize: 13,
  },
  rowProgress: {
    marginTop: spacing.sm,
  },
});
