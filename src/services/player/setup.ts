import TrackPlayer, {
  AndroidAudioContentType,
  AppKilledPlaybackBehavior,
  Capability,
  IOSCategory,
  IOSCategoryMode,
} from 'react-native-track-player';

let setupPromise: Promise<void> | null = null;

/**
 * Prepara o player nativo. É idempotente: várias telas podem chamar sem
 * risco de inicializar duas vezes.
 */
export function ensurePlayerSetup(): Promise<void> {
  if (!setupPromise) {
    setupPromise = setup().catch((error: unknown) => {
      // Permite uma nova tentativa se a inicialização falhar (por exemplo,
      // quando o Android recusa a criação do player com o app em segundo plano).
      setupPromise = null;
      throw error;
    });
  }
  return setupPromise;
}

async function setup(): Promise<void> {
  await TrackPlayer.setupPlayer({
    // `Speech` faz o Android pausar a leitura em interrupções curtas em vez de
    // abaixar o volume — o que, numa narração, deixaria o trecho ininteligível.
    androidAudioContentType: AndroidAudioContentType.Speech,
    autoHandleInterruptions: true,
    iosCategory: IOSCategory.Playback,
    iosCategoryMode: IOSCategoryMode.SpokenAudio,
    // Buffer curto: cada faixa é um trecho de poucos segundos, já em disco.
    minBuffer: 5,
    playBuffer: 1,
  });

  await TrackPlayer.updateOptions({
    android: {
      // A leitura continua mesmo se o app for removido dos recentes.
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.JumpForward,
      Capability.JumpBackward,
    ],
    // O que aparece na notificação recolhida e na tela bloqueada.
    compactCapabilities: [Capability.JumpBackward, Capability.Play, Capability.JumpForward],
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.JumpBackward,
      Capability.JumpForward,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    forwardJumpInterval: 30,
    backwardJumpInterval: 15,
    // Usado para gravar onde a leitura parou.
    progressUpdateEventInterval: 2,
  });
}
