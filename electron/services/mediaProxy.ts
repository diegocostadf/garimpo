import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import { extname } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { urlHasHost } from '../utils/urlHost'

// Streams a remote preview clip through the local server so the renderer can
// read it with Web Audio (the VU meters need CORS-clean audio). Only the
// streaming CDNs Garimpo already plays from are allowed, and Range requests
// are forwarded so seeking stays a single ranged fetch.
const PREVIEW_HOSTS = ['dzcdn.net', 'deezer.com', 'qobuz.com', 'akamaized.net', 'cloudfront.net']

export function isAllowedPreviewUrl(target: string): boolean {
  try {
    const u = new URL(target)
    return (u.protocol === 'https:' || u.protocol === 'http:') && urlHasHost(target, PREVIEW_HOSTS)
  } catch {
    return false
  }
}

export function pipeRemoteAudio(target: string, req: IncomingMessage, res: ServerResponse, redirects = 0): void {
  if (!isAllowedPreviewUrl(target) || redirects > 4) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Preview host not allowed')
    return
  }
  const lib = target.startsWith('https:') ? https : http
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0' }
  if (typeof req.headers.range === 'string') headers.Range = req.headers.range
  const upstream = lib.get(target, { headers }, (up) => {
    const status = up.statusCode || 502
    if (status >= 300 && status < 400 && up.headers.location) {
      up.resume()
      pipeRemoteAudio(new URL(up.headers.location, target).toString(), req, res, redirects + 1)
      return
    }
    const out: Record<string, string> = {
      'Content-Type': String(up.headers['content-type'] || 'audio/mpeg'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=600'
    }
    if (up.headers['content-length']) out['Content-Length'] = String(up.headers['content-length'])
    if (up.headers['content-range']) out['Content-Range'] = String(up.headers['content-range'])
    res.writeHead(status, out)
    up.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.on('close', () => upstream.destroy())
}

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
}

export function isAudioPath(p: string): boolean {
  return extname(p).toLowerCase() in AUDIO_TYPES
}

// Serves one local audio file (the library analyzer decodes it in the
// renderer). Restricted to audio extensions; supports Range for playback.
export function serveLocalAudio(path: string, req: IncomingMessage, res: ServerResponse): void {
  if (!path || !isAudioPath(path)) {
    res.writeHead(400); res.end('Not an audio file'); return
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(path)
    if (!stat.isFile()) throw new Error('not a file')
  } catch {
    res.writeHead(404); res.end('Not found'); return
  }
  const type = AUDIO_TYPES[extname(path).toLowerCase()]
  const range = typeof req.headers.range === 'string' ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes'
    })
    fs.createReadStream(path, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' })
  fs.createReadStream(path).pipe(res)
}
