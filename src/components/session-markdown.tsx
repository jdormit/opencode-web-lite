import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function SessionMarkdown({ text }: { text: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
      img: ({ alt }) => <span>[Image omitted: {alt ?? 'no description'}]</span>,
      h1: ({ children }) => <h3>{children}</h3>,
      h2: ({ children }) => <h3>{children}</h3>,
    }}
  >{text}</ReactMarkdown>
}

function SafeLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href) return <span>{children}</span>
  let url: URL
  try {
    url = new URL(href, 'https://opencode-web-lite.invalid')
  } catch {
    return <span>{children}</span>
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    return <span>{children}</span>
  }
  const external = url.origin !== 'https://opencode-web-lite.invalid' && url.protocol !== 'mailto:'
  return <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
}
