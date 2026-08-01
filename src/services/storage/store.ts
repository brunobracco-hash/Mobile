import AsyncStorage from '@react-native-async-storage/async-storage';

/** Chaves usadas no armazenamento local. */
export const StorageKeys = {
  documents: 'vozpdf:documents',
  settings: 'vozpdf:settings',
  progress: (documentId: string) => `vozpdf:progress:${documentId}`,
} as const;

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Um valor corrompido não deve impedir o app de abrir.
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function remove(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
