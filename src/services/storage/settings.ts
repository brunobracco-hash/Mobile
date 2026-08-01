import type { AppSettings } from '@/core/settings/settings';
import { normalizeSettings } from '@/core/settings/settings';

import { readJson, StorageKeys, writeJson } from './store';

export async function loadSettings(): Promise<AppSettings> {
  return normalizeSettings(await readJson<unknown>(StorageKeys.settings));
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJson(StorageKeys.settings, normalizeSettings(settings));
}
