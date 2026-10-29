export function extractYouTubeId(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '')

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0]
    return id || null
  }

  if (host === 'youtube.com') {
    if (url.pathname === '/watch') return url.searchParams.get('v')
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/)
    if (shortsMatch) return shortsMatch[1]
    const embedMatch = url.pathname.match(/^\/embed\/([^/]+)/)
    if (embedMatch) return embedMatch[1]
  }

  return null
}
