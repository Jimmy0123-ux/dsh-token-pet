import { useEffect, useState } from 'react'
import { loadSettings, normalizeSettings, SETTINGS_EVENT, type TokenPetSettings } from './settings.ts'

/** Both settings surfaces and portals observe the same persisted preferences. */
export function useSettings(): TokenPetSettings {
  const [settings, setSettings] = useState<TokenPetSettings>(loadSettings)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = (event: Event) => {
      const detail = (event as CustomEvent<Partial<TokenPetSettings>>).detail
      setSettings(detail ? normalizeSettings(detail) : loadSettings())
    }
    window.addEventListener(SETTINGS_EVENT, update)
    window.addEventListener('storage', update)
    // Close the render-to-subscribe gap, including another mounted settings form.
    setSettings(loadSettings())
    return () => {
      window.removeEventListener(SETTINGS_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return settings
}
export function useLanguage() { return useSettings().language }
