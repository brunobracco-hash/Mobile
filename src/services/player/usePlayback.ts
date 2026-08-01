import { useSyncExternalStore } from 'react';

import { playbackController, type PlaybackSnapshot } from './PlaybackController';

/** Estado atual da leitura, sincronizado com o controlador. */
export function usePlayback(): PlaybackSnapshot {
  return useSyncExternalStore(
    (onChange) => playbackController.subscribe(() => onChange()),
    () => playbackController.getSnapshot()
  );
}

export { playbackController };
