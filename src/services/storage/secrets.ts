import * as SecureStore from 'expo-secure-store';

import type { TtsProviderId } from '@/core/tts/types';

/**
 * Chaves de API ficam no armazenamento seguro do sistema (Keychain no iOS,
 * EncryptedSharedPreferences no Android), nunca no AsyncStorage junto com os
 * demais ajustes.
 */
function keyFor(providerId: TtsProviderId): string {
  return `vozpdf_api_key_${providerId}`;
}

export async function getApiKey(providerId: TtsProviderId): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyFor(providerId));
  } catch {
    return null;
  }
}

export async function setApiKey(providerId: TtsProviderId, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    await SecureStore.deleteItemAsync(keyFor(providerId));
    return;
  }
  await SecureStore.setItemAsync(keyFor(providerId), trimmed, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearApiKey(providerId: TtsProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(providerId));
}
