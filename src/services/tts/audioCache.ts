import { File } from 'expo-file-system';

import { audioDirectory } from '../storage/paths';

export interface CacheStats {
  files: number;
  bytes: number;
}

export function audioCacheStats(): CacheStats {
  const directory = audioDirectory();
  let files = 0;
  let bytes = 0;
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) continue;
    files += 1;
    bytes += entry.size;
  }
  return { files, bytes };
}

export function clearAudioCache(): void {
  const directory = audioDirectory();
  for (const entry of directory.list()) {
    try {
      entry.delete();
    } catch {
      // Um arquivo em uso pelo player pode falhar; os demais são apagados.
    }
  }
}

/**
 * Mantém o cache dentro do limite configurado, apagando os arquivos mais
 * antigos primeiro. É chamado depois de sintetizar, não antes: nunca apagamos
 * um áudio que está prestes a tocar.
 */
export function trimAudioCache(limitBytes: number, protectedUris: ReadonlySet<string>): number {
  const directory = audioDirectory();
  const entries = directory
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .map((file) => ({
      file,
      size: file.size,
      modifiedAt: file.info().modificationTime ?? 0,
    }));

  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= limitBytes) return 0;

  let removed = 0;
  for (const entry of entries.sort((a, b) => a.modifiedAt - b.modifiedAt)) {
    if (total <= limitBytes) break;
    if (protectedUris.has(entry.file.uri)) continue;
    try {
      entry.file.delete();
      total -= entry.size;
      removed += 1;
    } catch {
      // Ignora arquivos que não puderam ser apagados.
    }
  }
  return removed;
}
