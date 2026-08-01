import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';

import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, coerceLanguage } from '@/core/text/language';
import type { LanguageCode } from '@/core/text/language';
import { getProvider, TTS_PROVIDERS, voicesFor } from '@/core/tts/registry';
import type { TtsProviderId, VoiceOption } from '@/core/tts/types';
import { selectedVoice, withVoice } from '@/core/settings/settings';
import { useSettings } from '@/services/settings/SettingsProvider';
import { clearApiKey, getApiKey, setApiKey } from '@/services/storage/secrets';
import { audioCacheStats, clearAudioCache } from '@/services/tts/audioCache';
import { Banner, Button, Card, SectionTitle } from '@/ui/components';
import { radius, spacing, useTheme } from '@/ui/theme';

const SLEEP_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Desligado', value: null },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, update, replace } = useSettings();

  const provider = getProvider(settings.providerId);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyStored, setKeyStored] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [deviceVoices, setDeviceVoices] = useState<Speech.Voice[]>([]);
  const [cache, setCache] = useState(() => ({ files: 0, bytes: 0 }));

  useEffect(() => {
    setApiKeyInput('');
    setKeyMessage(null);
    void getApiKey(settings.providerId).then((key) => setKeyStored(Boolean(key)));
  }, [settings.providerId]);

  useEffect(() => {
    void Speech.getAvailableVoicesAsync()
      .then(setDeviceVoices)
      .catch(() => setDeviceVoices([]));
    try {
      setCache(audioCacheStats());
    } catch {
      setCache({ files: 0, bytes: 0 });
    }
  }, []);

  const saveKey = useCallback(async () => {
    const value = apiKeyInput.trim();
    if (value.length === 0) return;
    if (provider.apiKeyPattern && !provider.apiKeyPattern.test(value)) {
      setKeyMessage(`Esta chave não parece uma chave do ${provider.name}. Confira e tente de novo.`);
      return;
    }
    await setApiKey(provider.id, value);
    setApiKeyInput('');
    setKeyStored(true);
    setKeyMessage('Chave salva no armazenamento seguro do aparelho.');
  }, [apiKeyInput, provider]);

  const removeKey = useCallback(async () => {
    await clearApiKey(provider.id);
    setKeyStored(false);
    setKeyMessage('Chave removida.');
  }, [provider.id]);

  const pickVoice = useCallback(
    (language: LanguageCode, voiceId: string) => {
      void replace(withVoice(settings, settings.providerId, language, voiceId));
    },
    [replace, settings]
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + spacing.xl }]}>
      <SectionTitle>Voz da narração</SectionTitle>
      <Card>
        {TTS_PROVIDERS.map((candidate) => {
          const active = candidate.id === settings.providerId;
          return (
            <Pressable
              key={candidate.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => void update({ providerId: candidate.id })}
              style={[
                styles.option,
                { borderColor: active ? theme.accent : theme.border },
                active && { backgroundColor: theme.highlight },
              ]}>
              <Text style={[styles.optionTitle, { color: theme.text }]}>{candidate.name}</Text>
              <Text style={[styles.optionText, { color: theme.textMuted }]}>
                {candidate.summary}
              </Text>
            </Pressable>
          );
        })}
      </Card>

      {provider.requiresApiKey ? (
        <>
          <SectionTitle>Chave de API — {provider.name}</SectionTitle>
          <Card>
            <Text style={[styles.optionText, { color: theme.textMuted }]}>
              {keyStored
                ? 'Uma chave já está salva neste aparelho.'
                : `Obtenha em: ${provider.apiKeyHint ?? '—'}`}
            </Text>
            <TextInput
              value={apiKeyInput}
              onChangeText={setApiKeyInput}
              placeholder={keyStored ? 'Substituir a chave salva' : 'Cole a chave aqui'}
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
            />
            <View style={styles.row}>
              <Button label="Salvar chave" onPress={() => void saveKey()} style={styles.grow} />
              {keyStored ? (
                <Button label="Remover" variant="danger" onPress={() => void removeKey()} />
              ) : null}
            </View>
            {keyMessage ? <Banner tone="info">{keyMessage}</Banner> : null}
            <Text style={[styles.fineprint, { color: theme.textMuted }]}>
              A chave fica só no seu aparelho, no armazenamento seguro do sistema. O texto dos seus
              PDFs é enviado ao serviço escolhido para virar áudio.
            </Text>
          </Card>
        </>
      ) : null}

      <SectionTitle>Vozes por idioma</SectionTitle>
      <Card>
        {SUPPORTED_LANGUAGES.map((language) => (
          <View key={language} style={styles.languageBlock}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>
              {LANGUAGE_LABELS[language]}
            </Text>
            <VoicePicker
              language={language}
              providerId={settings.providerId}
              deviceVoices={deviceVoices}
              selected={selectedVoice(settings, settings.providerId, language)}
              onSelect={(voiceId) => pickVoice(language, voiceId)}
            />
          </View>
        ))}
      </Card>

      <SectionTitle>Leitura</SectionTitle>
      <Card>
        <View style={styles.switchRow}>
          <View style={styles.grow}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>Estilo de audiolivro</Text>
            <Text style={[styles.optionText, { color: theme.textMuted }]}>
              Pede à IA um ritmo de narração humana, com pausas naturais. Só tem efeito nos
              provedores que aceitam direção de estilo.
            </Text>
          </View>
          <Switch
            value={settings.narrationStyle}
            onValueChange={(value) => void update({ narrationStyle: value })}
          />
        </View>

        <Text style={[styles.optionTitle, { color: theme.text, marginTop: spacing.md }]}>
          Trechos preparados à frente: {settings.prefetchCount}
        </Text>
        <Text style={[styles.optionText, { color: theme.textMuted }]}>
          Quanto maior, menor a chance de pausa entre trechos — e maior o consumo de dados
          adiantado.
        </Text>
        <View style={styles.row}>
          {[1, 2, 3, 5, 8].map((value) => (
            <Chip
              key={value}
              label={String(value)}
              active={settings.prefetchCount === value}
              onPress={() => void update({ prefetchCount: value })}
            />
          ))}
        </View>

        <Text style={[styles.optionTitle, { color: theme.text, marginTop: spacing.md }]}>
          Temporizador de sono
        </Text>
        <View style={styles.row}>
          {SLEEP_OPTIONS.map((option) => (
            <Chip
              key={option.label}
              label={option.label}
              active={settings.sleepTimerMinutes === option.value}
              onPress={() => void update({ sleepTimerMinutes: option.value })}
            />
          ))}
        </View>
      </Card>

      <SectionTitle>Aparência</SectionTitle>
      <Card>
        <View style={styles.row}>
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <Chip
              key={mode}
              label={mode === 'system' ? 'Do sistema' : mode === 'light' ? 'Claro' : 'Escuro'}
              active={settings.theme === mode}
              onPress={() => void update({ theme: mode })}
            />
          ))}
        </View>
      </Card>

      <SectionTitle>Áudio guardado</SectionTitle>
      <Card>
        <Text style={[styles.optionText, { color: theme.textMuted }]}>
          {cache.files} {cache.files === 1 ? 'arquivo' : 'arquivos'} · {formatBytes(cache.bytes)}. O
          áudio já sintetizado é reaproveitado: reouvir um trecho não gasta nada.
        </Text>
        <Button
          label="Limpar áudio guardado"
          variant="secondary"
          onPress={() =>
            Alert.alert(
              'Limpar áudio',
              'Os trechos já narrados precisarão ser gerados de novo na próxima leitura.',
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Limpar',
                  style: 'destructive',
                  onPress: () => {
                    clearAudioCache();
                    setCache(audioCacheStats());
                  },
                },
              ]
            )
          }
        />
      </Card>
    </ScrollView>
  );
}

function VoicePicker({
  language,
  providerId,
  selected,
  deviceVoices,
  onSelect,
}: {
  language: LanguageCode;
  providerId: TtsProviderId;
  selected: string | undefined;
  deviceVoices: Speech.Voice[];
  onSelect: (voiceId: string) => void;
}) {
  const theme = useTheme();

  const options: VoiceOption[] =
    providerId === 'device'
      ? deviceVoices
          .filter((voice) => coerceLanguage(voice.language) === language)
          .map((voice) => ({
            id: voice.identifier,
            label: voice.name,
            description: voice.quality === 'Enhanced' ? 'Qualidade aprimorada' : voice.language,
            gender: 'neutra' as const,
            languages: [language],
          }))
      : voicesFor(providerId, language);

  if (options.length === 0) {
    return (
      <Text style={[styles.optionText, { color: theme.textMuted }]}>
        {providerId === 'device'
          ? 'Nenhuma voz deste idioma instalada no aparelho. Instale-a nas configurações de idioma do sistema.'
          : 'Nenhuma voz disponível.'}
      </Text>
    );
  }

  return (
    <View style={styles.row}>
      {options.map((voice) => (
        <Pressable
          key={voice.id}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === voice.id }}
          onPress={() => onSelect(voice.id)}
          style={[
            styles.voice,
            {
              borderColor: selected === voice.id ? theme.accent : theme.border,
              backgroundColor: selected === voice.id ? theme.highlight : 'transparent',
            },
          ]}>
          <Text style={[styles.voiceName, { color: theme.text }]}>{voice.label}</Text>
          <Text style={[styles.voiceDescription, { color: theme.textMuted }]} numberOfLines={2}>
            {voice.description}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? theme.accent : theme.border,
          backgroundColor: active ? theme.highlight : 'transparent',
        },
      ]}>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: active ? '700' : '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
  },
  option: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  optionText: {
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    marginVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  grow: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  languageBlock: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  voice: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 140,
    flexGrow: 1,
  },
  voiceName: {
    fontSize: 15,
    fontWeight: '600',
  },
  voiceDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 52,
    alignItems: 'center',
  },
  fineprint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
});
