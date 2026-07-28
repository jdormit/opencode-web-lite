import type { ComposerAttachment } from './composer-state'

export const MAX_ATTACHMENTS = 10
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_TOTAL_BYTES = 25 * 1024 * 1024

const textExtensions = new Set([
  'c', 'cc', 'conf', 'cpp', 'css', 'csv', 'go', 'h', 'hpp', 'html', 'ini', 'java', 'js', 'json', 'jsx',
  'kt', 'log', 'md', 'php', 'py', 'rb', 'rs', 'sh', 'sql', 'svg', 'toml', 'ts', 'tsx', 'txt', 'xml', 'yaml', 'yml',
])

export function supportedAttachmentMime(file: Pick<File, 'name' | 'type'>) {
  const declared = file.type.toLowerCase()
  if (declared.startsWith('image/')) return declared
  if (declared === 'application/pdf') return declared
  if (declared.startsWith('text/')) return declared
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return textExtensions.has(extension) ? 'text/plain' : undefined
}

export function validateAttachmentFiles(current: ComposerAttachment[], files: File[]) {
  const accepted: Array<{ file: File; mime: string }> = []
  const errors: string[] = []
  let total = current.reduce((sum, attachment) => sum + attachment.file.size, 0)
  for (const file of files) {
    if (current.length + accepted.length >= MAX_ATTACHMENTS) {
      errors.push(`Only ${MAX_ATTACHMENTS} attachments can be added.`)
      break
    }
    const mime = supportedAttachmentMime(file)
    if (!mime) {
      errors.push(`${file.name} is not a supported image, PDF, or text file.`)
      continue
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${file.name} exceeds the 10 MiB file limit.`)
      continue
    }
    if (total + file.size > MAX_ATTACHMENTS_TOTAL_BYTES) {
      errors.push('Attachments exceed the 25 MiB total limit.')
      continue
    }
    total += file.size
    accepted.push({ file, mime })
  }
  return { accepted, errors }
}

export function modelAcceptsMime(
  capabilities: { image: boolean; pdf: boolean }, mime: string,
) {
  if (mime.startsWith('image/')) return capabilities.image
  if (mime === 'application/pdf') return capabilities.pdf
  return true
}

export function fileToDataUrl(file: File, mime: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`))
    reader.onload = () => {
      if (typeof reader.result !== 'string') return reject(new Error(`${file.name} could not be read.`))
      const comma = reader.result.indexOf(',')
      resolve(comma < 0 ? reader.result : `data:${mime};base64,${reader.result.slice(comma + 1)}`)
    }
    reader.readAsDataURL(file)
  })
}

export function dataUrlSourceBytes(url: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url)
  if (!match) return
  const payload = match[2]!
  return Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
}
