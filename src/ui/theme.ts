import { useColorScheme } from 'react-native';

import { useSettings } from '@/services/settings/SettingsProvider';

export interface Theme {
  dark: boolean;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  danger: string;
  highlight: string;
}

const DARK: Theme = {
  dark: true,
  background: '#0B1020',
  surface: '#151B2E',
  surfaceAlt: '#1D2540',
  border: '#2A3352',
  text: '#EEF1F8',
  textMuted: '#98A2C0',
  accent: '#6C8CFF',
  accentText: '#0B1020',
  danger: '#FF7A7A',
  highlight: '#243056',
};

const LIGHT: Theme = {
  dark: false,
  background: '#F7F8FC',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F8',
  border: '#DDE2EF',
  text: '#141A2B',
  textMuted: '#5C6683',
  accent: '#3B5BDB',
  accentText: '#FFFFFF',
  danger: '#C92A2A',
  highlight: '#DCE4FF',
};

export function useTheme(): Theme {
  const system = useColorScheme();
  const { settings } = useSettings();
  const mode = settings.theme === 'system' ? (system ?? 'light') : settings.theme;
  return mode === 'dark' ? DARK : LIGHT;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
} as const;
