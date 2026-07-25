export const themeValues = ['system', 'light', 'dark'] as const

export type Theme = (typeof themeValues)[number]

export function parseThemeCookie(cookieHeader: string | null | undefined): Theme {
  if (!cookieHeader) return 'system'

  for (const item of cookieHeader.split(';')) {
    const [rawName, rawValue] = item.trim().split('=', 2)
    if (rawName !== 'color-scheme') continue

    const value = safeDecode(rawValue)
    if (isTheme(value)) return value
  }

  return 'system'
}

function isTheme(value: string): value is Theme {
  return themeValues.some((theme) => theme === value)
}

function safeDecode(value: string | undefined): string {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

export const themePreloadScript = `(()=>{try{const m=document.cookie.match(/(?:^|; )color-scheme=([^;]*)/);const p=m?decodeURIComponent(m[1]):'system';const t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=t}catch{}})()`
