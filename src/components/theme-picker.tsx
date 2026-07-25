import { useEffect, useState } from 'react'

import { strings } from '~/lib/strings'
import { themeValues, type Theme } from '~/lib/theme'

type ThemePickerProps = Readonly<{ initialTheme: Theme }>

export function ThemePicker({ initialTheme }: ThemePickerProps) {
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => {
    if (theme !== 'system') return

    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    const applySystemTheme = () => {
      document.documentElement.dataset.theme = preference.matches ? 'dark' : 'light'
    }

    preference.addEventListener('change', applySystemTheme)
    return () => preference.removeEventListener('change', applySystemTheme)
  }, [theme])

  function updateTheme(nextTheme: Theme) {
    setTheme(nextTheme)
    document.cookie = `color-scheme=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`

    const resolved =
      nextTheme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : nextTheme
    document.documentElement.dataset.theme = resolved
  }

  return (
    <label className="theme-picker">
      <span>{strings.theme.label}</span>
      <select
        value={theme}
        onChange={(event) => updateTheme(event.target.value as Theme)}
      >
        {themeValues.map((value) => (
          <option key={value} value={value}>
            {strings.theme[value]}
          </option>
        ))}
      </select>
    </label>
  )
}
