import 'expo-router/entry';
import TrackPlayer from 'react-native-track-player';

import { PlaybackService } from './src/services/player/service';

// O serviço precisa ser registrado no carregamento do bundle, antes de qualquer
// tela existir: é ele que o sistema aciona quando o usuário toca em play na
// notificação ou na tela bloqueada, com o app fora da memória.
TrackPlayer.registerPlaybackService(() => PlaybackService);
