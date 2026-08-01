import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * Serviço de reprodução do react-native-track-player.
 *
 * Roda fora do ciclo de vida da interface: é ele que responde aos botões da
 * notificação e da tela bloqueada, e é o que mantém a leitura tocando com o
 * aparelho no bolso e a tela apagada. No Android o player roda como serviço em
 * primeiro plano; no iOS, sob o modo de fundo `audio` declarado no app.json.
 */
export async function PlaybackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.pause());

  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());

  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => TrackPlayer.seekTo(position));

  TrackPlayer.addEventListener(Event.RemoteJumpForward, async ({ interval }) => {
    const { position, duration } = await TrackPlayer.getProgress();
    const target = position + interval;
    // Pular além do fim do trecho vira "próximo trecho".
    if (duration > 0 && target >= duration) await TrackPlayer.skipToNext();
    else await TrackPlayer.seekTo(target);
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, async ({ interval }) => {
    const { position } = await TrackPlayer.getProgress();
    const target = position - interval;
    if (target < 0) {
      try {
        await TrackPlayer.skipToPrevious();
      } catch {
        await TrackPlayer.seekTo(0);
      }
    } else {
      await TrackPlayer.seekTo(target);
    }
  });

  // Ligações e alarmes pausam a leitura; ao fim da interrupção ela volta.
  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }) => {
    if (permanent) await TrackPlayer.pause();
    else if (paused) await TrackPlayer.pause();
    else await TrackPlayer.play();
  });
}
