import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { AppSettings } from '@/core/settings/settings';
import { DEFAULT_SETTINGS } from '@/core/settings/settings';

import { loadSettings, saveSettings } from '../storage/settings';

interface SettingsApi {
  settings: AppSettings;
  loaded: boolean;
  update(patch: Partial<AppSettings>): Promise<void>;
  replace(next: AppSettings): Promise<void>;
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((stored) => {
        if (cancelled) return;
        setSettings(stored);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);

  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      // Usa o estado mais recente para não perder alterações concorrentes.
      let next: AppSettings = settings;
      setSettings((current) => {
        next = { ...current, ...patch };
        return next;
      });
      await saveSettings(next);
    },
    [settings]
  );

  const api = useMemo<SettingsApi>(
    () => ({ settings, loaded, update, replace }),
    [loaded, replace, settings, update]
  );

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings precisa estar dentro de SettingsProvider.');
  return context;
}
