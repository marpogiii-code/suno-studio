#!/usr/bin/env node
/**
 * Suno downloader — save a public Suno song as audio (m4a/mp3), MP4 video,
 * cover art and lyrics. Zero dependencies (Node 18+).
 *
 * Pipeline (same approach as usesuno.com/tools/downloader):
 *   1. Resolve the input to a clip id (song UUID, suno.com/s/<short>, /hook/<uuid>).
 *   2. Fetch the public suno.com/song/<id> page and parse the Next.js RSC flight
 *      payload (`self.__next_f.push([1, "..."])`) into the clip object.
 *   3. Audio: cdn1.suno.ai/<id>.mp3 is no longer public, so request a rights
 *      grant (content key + IV wrapped with AES-GCM under SHA-256(glt)), stream
 *      the encrypted .m4a from CloudFront and decrypt it with AES-128-CTR.
 *   4. Video / cover come straight from cdn1 / cdn2 (cover via proxy fallback).
 *
 * Usage:
 *   node tools/suno-downloader.mjs <url|id> [more urls...] [options]
 *     -o, --out <dir>       output directory (default: ./downloads)
 *     --audio / --no-audio  (default on)
 *     --video               also download the MP4
 *     --cover               also download the cover art
 *     --lyrics              also write lyrics/prompt as .txt
 *     --all                 audio + video + cover + lyrics
 *     --mp3                 convert the decrypted audio to MP3 (needs ffmpeg on PATH)
 *     --json                print clip metadata as JSON, download nothing
 *     --proxy <url>         CORS/HTML proxy prefix (default: SUNO_PROXY env or built-in)
 *     --rights <url>        rights endpoint (default: SUNO_RIGHTS_URL env or built-in)
 *     --origin <url>        Origin header sent to the rights endpoint (default: SUNO_RIGHTS_ORIGIN env)
 */
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { webcrypto } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

const { subtle } = webcrypto
const execFileAsync = promisify(execFile)

const DEFAULT_PROXY = process.env.SUNO_PROXY || 'https://sunoapi.aibiei.com/proxy?url='
const DEFAULT_RIGHTS_URL =
  process.env.SUNO_RIGHTS_URL || 'https://yellow-salad.aibiei.com/rights'
const DEFAULT_ORIGIN = process.env.SUNO_RIGHTS_ORIGIN || 'https://usesuno.com'
const AUDIO_BASE_URL = 'https://d2lwuy8qc234o3.cloudfront.net/1/clip/'
const HOOK_API = 'https://studio-api-prod.suno.com/api/video/hooks/'
const PLAYLIST_API = 'https://studio-api-prod.suno.com/api/playlist/'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const SHORT_RE = /suno\.com\/s\/([A-Za-z0-9_-]+)/i
const HOOK_RE = /suno\.com\/hook\/([0-9a-f-]{36})/i
const PLAYLIST_RE = /suno\.com\/playlist\/([0-9a-f-]{36})/i

// ---------- input parsing ----------

export function extractId(raw) {
  const str = String(raw || '').trim()
  const p = str.match(PLAYLIST_RE)
  if (p) return { type: 'playlist', id: p[1].toLowerCase() }
  const h = str.match(HOOK_RE)
  if (h) return { type: 'hook', id: h[1].toLowerCase() }
  const m = str.match(UUID_RE)
  if (m) return { type: 'song', id: m[0].toLowerCase() }
  const s = str.match(SHORT_RE)
  if (s) return { type: 'short', id: s[1] }
  return null
}

// ---------- RSC flight parsing ----------

function collectPayload(html) {
  const re = /self\.__next_f\.push\(\[\s*1\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\)/g
  let out = ''
  let m
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse('"' + m[1] + '"')
    } catch {
      out += m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
  }
  return out
}

function readNBytes(s, start, byteLen) {
  let got = 0
  let i = start
  while (i < s.length && got < byteLen) {
    const code = s.charCodeAt(i)
    let step = 1
    let bytes
    if (code < 0x80) bytes = 1
    else if (code < 0x800) bytes = 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes = 4
      step = 2
    } else bytes = 3
    got += bytes
    i += step
  }
  return { text: s.substring(start, i), next: i }
}

function readJsonValue(s, start) {
  let i = start
  while (i < s.length && /\s/.test(s[i])) i++
  if (i >= s.length) return null
  const c = s[i]
  if (c === '"') {
    let j = i + 1
    while (j < s.length) {
      if (s[j] === '\\') {
        j += 2
        continue
      }
      if (s[j] === '"') {
        j++
        break
      }
      j++
    }
    return { raw: s.substring(i, j), end: j }
  }
  if (c === '{' || c === '[') {
    let depth = 0
    let k = i
    while (k < s.length) {
      const cc = s[k]
      if (cc === '"') {
        k++
        while (k < s.length) {
          if (s[k] === '\\') {
            k += 2
            continue
          }
          if (s[k] === '"') {
            k++
            break
          }
          k++
        }
        continue
      }
      if (cc === '{' || cc === '[') depth++
      else if (cc === '}' || cc === ']') {
        depth--
        if (depth === 0) {
          k++
          break
        }
      }
      k++
    }
    return { raw: s.substring(i, k), end: k }
  }
  const scalar = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
    s.substring(i)
  )
  if (scalar) return { raw: scalar[0], end: i + scalar[0].length }
  return null
}

function parseFlight(payload) {
  const map = new Map()
  let i = 0
  const n = payload.length
  while (i < n) {
    let j = i
    while (j < n && /[0-9a-f]/i.test(payload[j])) j++
    if (j === i || payload[j] !== ':') {
      i = j + 1
      continue
    }
    const id = payload.substring(i, j).toLowerCase()
    const k = j + 1
    const typeCh = payload[k]
    if (typeCh === 'T') {
      const hexStart = k + 1
      let m = hexStart
      while (m < n && /[0-9a-f]/i.test(payload[m])) m++
      if (payload[m] !== ',') {
        i = m + 1
        continue
      }
      const byteLen = parseInt(payload.substring(hexStart, m), 16)
      const got = readNBytes(payload, m + 1, byteLen)
      map.set(id, got.text)
      i = got.next
      if (payload[i] === '\n') i++
      continue
    }
    const start = 'IHMJL'.includes(typeCh) ? k + 1 : k
    const v = readJsonValue(payload, start)
    if (v) {
      let parsed
      try {
        parsed = JSON.parse(v.raw)
      } catch {
        parsed = v.raw
      }
      map.set(id, parsed)
      i = v.end
      if (payload[i] === '\n') i++
      continue
    }
    i = k + 1
  }
  return map
}

function deref(node, map, seen = new Set(), depth = 0) {
  if (depth > 40 || node == null) return node
  if (typeof node === 'string') {
    const m = /^\$[LSH]?([0-9a-f]+)$/i.exec(node)
    if (!m) return node
    const key = m[1].toLowerCase()
    if (seen.has(key) || !map.has(key)) return node
    seen.add(key)
    const out = deref(map.get(key), map, seen, depth + 1)
    seen.delete(key)
    return out
  }
  if (Array.isArray(node)) return node.map((x) => deref(x, map, seen, depth + 1))
  if (typeof node === 'object') {
    const o = {}
    for (const k of Object.keys(node)) o[k] = deref(node[k], map, seen, depth + 1)
    return o
  }
  return node
}

function findAllClips(val, out, seen) {
  if (!val || typeof val !== 'object') return
  if (Array.isArray(val)) {
    for (const v of val) findAllClips(v, out, seen)
    return
  }
  if (val.clip && typeof val.clip === 'object' && val.clip.id && !seen.has(val.clip.id)) {
    seen.add(val.clip.id)
    out.push(val.clip)
  }
  for (const k of Object.keys(val)) findAllClips(val[k], out, seen)
}

function resolveFlight(html) {
  const payload = collectPayload(html)
  if (!payload) return {}
  const map = parseFlight(payload)
  const resolved = {}
  for (const [k, v] of map) resolved[k] = deref(v, map)
  return resolved
}

function normalizeClip(clip, id) {
  clip.id = clip.id || id
  clip.audio_url = clip.audio_url || `https://cdn1.suno.ai/${clip.id}.mp3`
  clip.video_url = clip.video_url || `https://cdn1.suno.ai/${clip.id}.mp4`
  clip.image_url = clip.image_url || `https://cdn2.suno.ai/image_${clip.id}.jpeg`
  clip.image_large_url =
    clip.image_large_url || `https://cdn2.suno.ai/image_large_${clip.id}.jpeg`
  clip.metadata = clip.metadata || {}
  return clip
}

export function parseSongHtml(html, id) {
  const clips = []
  findAllClips(resolveFlight(html), clips, new Set())
  const clip = clips.find((c) => c.id === id) || clips[0]
  if (clip) return normalizeClip(clip, id)
  const mt = html.match(/<title>([^<]*)<\/title>/i)
  let title = id
  let handle = ''
  if (mt) {
    const h = mt[1].match(/^(.*) by @?([^\s|]+)\s*\|\s*Suno$/)
    if (h) {
      title = h[1].trim()
      handle = h[2].trim()
    } else title = mt[1].replace(/\|\s*Suno\s*$/, '').trim()
  }
  return normalizeClip({ id, title, handle, display_name: handle, _fallback: true }, id)
}

export function parsePlaylistHtml(html, id) {
  const resolved = resolveFlight(html)
  const clips = []
  findAllClips(resolved, clips, new Set())
  const mt = html.match(/<title>([^<]*)<\/title>/i)
  const name =
    (mt ? mt[1].replace(/\s*\|\s*Suno\s*$/i, '').trim() : '') ||
    `Playlist ${id.slice(0, 8)}`
  return { id, name, clips: clips.map((c) => normalizeClip(c, c.id)) }
}

// ---------- network ----------

async function fetchText(url, opts) {
  const direct = await fetch(url, {
    headers: { 'User-Agent': UA },
    redirect: 'follow'
  }).catch(() => null)
  if (direct && direct.ok) {
    const text = await direct.text()
    if (text.includes('__next_f')) return { text, url: direct.url }
  }
  const res = await fetch(opts.proxy + encodeURIComponent(url), {
    headers: { 'User-Agent': UA }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const text = await res.text()
  if (text.length < 400) throw new Error(`Empty response for ${url}`)
  return { text, url }
}

async function fetchHook(hookId, opts) {
  const tryJson = async (u) => {
    const r = await fetch(u, { headers: { 'User-Agent': UA } }).catch(() => null)
    return r && r.ok ? r.json().catch(() => null) : null
  }
  const data =
    (await tryJson(HOOK_API + hookId)) ||
    (await tryJson(opts.proxy + encodeURIComponent(HOOK_API + hookId)))
  if (!data || !data.clip || !data.clip.id) return null
  const clip = normalizeClip({ ...data.clip }, data.clip.id)
  clip.title = clip.title || data.title || 'Suno hook'
  if (data.rendered_video_url) clip.video_url = data.rendered_video_url
  if (data.thumbnail_image_url) clip.image_url = data.thumbnail_image_url
  clip.hook_id = data.id || hookId
  return clip
}

async function fetchJson(url, opts) {
  for (const u of [url, opts.proxy + encodeURIComponent(url)]) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } }).catch(() => null)
    if (r && r.ok) {
      const data = await r.json().catch(() => null)
      if (data) return data
    }
  }
  return null
}

async function fetchPlaylistClips(id, opts) {
  const clips = []
  const seen = new Set()
  for (let page = 1; page < 200; page++) {
    const data = await fetchJson(`${PLAYLIST_API}${id}/?page=${page}`, opts)
    const entries = data && Array.isArray(data.playlist_clips) ? data.playlist_clips : []
    if (!entries.length) break
    for (const e of entries) {
      const c = e && e.clip
      if (c && c.id && !seen.has(c.id)) {
        seen.add(c.id)
        clips.push(normalizeClip({ ...c }, c.id))
      }
    }
    if (data.num_total_results != null && clips.length >= data.num_total_results) break
  }
  return clips
}

export async function resolveClips(input, opts) {
  const ref = extractId(input)
  if (!ref) throw new Error(`Not a Suno link or id: ${input}`)
  if (ref.type === 'playlist') {
    const fromApi = await fetchPlaylistClips(ref.id, opts)
    if (fromApi.length) return fromApi
    const { text } = await fetchText(`https://suno.com/playlist/${ref.id}`, opts)
    const clips = parsePlaylistHtml(text, ref.id).clips
    if (!clips.length) throw new Error('Playlist is empty or not public')
    return clips
  }
  if (ref.type === 'hook') {
    const clip = await fetchHook(ref.id, opts)
    if (!clip) throw new Error('Could not load public Hook details')
    return [clip]
  }
  const target =
    ref.type === 'short'
      ? `https://suno.com/s/${ref.id}`
      : `https://suno.com/song/${ref.id}`
  const { text } = await fetchText(target, opts)
  let id = ref.id
  if (ref.type === 'short') {
    const hook = text.match(HOOK_RE)
    if (hook) {
      const clip = await fetchHook(hook[1].toLowerCase(), opts)
      if (clip) return [clip]
    }
    id = (text.match(UUID_RE) || [''])[0].toLowerCase()
    if (!id) throw new Error('Could not resolve short link to a song id')
  }
  return [parseSongHtml(text, id)]
}

// ---------- encrypted audio ----------

function b64ToBytes(v) {
  let s = String(v || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  while (s.length % 4) s += '='
  return new Uint8Array(Buffer.from(s, 'base64'))
}

async function fetchRights(id, opts) {
  const res = await fetch(opts.rightsUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Origin: opts.origin,
      Referer: opts.origin + '/tools/downloader/'
    },
    body: JSON.stringify({ content_params: { content_id: id, content_type: 'clip' } })
  })
  if (!res.ok)
    throw new Error(
      `Audio authorization failed (HTTP ${res.status}): ${(await res.text()).slice(0, 160)}`
    )
  const rights = await res.json()
  if (!rights.key || !rights.iv || !rights.glt)
    throw new Error('Rights response missing key/iv/glt')
  return rights
}

async function unwrap(wrappedB64, id, userKey) {
  const wrapped = b64ToBytes(wrappedB64)
  if (wrapped.byteLength < 28) throw new Error('Wrapped value too short')
  const raw = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: wrapped.slice(0, 12),
      additionalData: new TextEncoder().encode(id)
    },
    userKey,
    wrapped.slice(12)
  )
  return new Uint8Array(raw)
}

function addCounter(iv, blocks) {
  const c = new Uint8Array(iv)
  let v = 0n
  for (const b of c) v = (v << 8n) | BigInt(b)
  v += BigInt(blocks)
  for (let j = c.length - 1; j >= 0; j--) {
    c[j] = Number(v & 255n)
    v >>= 8n
  }
  return c
}

function ctrDecryptStream(key, iv) {
  let pending = new Uint8Array(0)
  let blockOffset = 0
  const dec = async (buf) => {
    const out = await subtle.decrypt(
      { name: 'AES-CTR', counter: addCounter(iv, blockOffset), length: 128 },
      key,
      buf
    )
    blockOffset += Math.ceil(buf.byteLength / 16)
    return Buffer.from(out)
  }
  return new Transform({
    async transform(chunk, _enc, cb) {
      try {
        const merged = new Uint8Array(pending.byteLength + chunk.byteLength)
        merged.set(pending)
        merged.set(chunk, pending.byteLength)
        const len = 16 * Math.floor(merged.byteLength / 16)
        if (len) this.push(await dec(merged.subarray(0, len)))
        pending = merged.slice(len)
        cb()
      } catch (e) {
        cb(e)
      }
    },
    async flush(cb) {
      try {
        if (pending.byteLength) this.push(await dec(pending))
        cb()
      } catch (e) {
        cb(e)
      }
    }
  })
}

function sniffAudioExt(head) {
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return 'webm'
  if (
    (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) ||
    (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
  )
    return 'mp3'
  return 'm4a'
}

export async function downloadAudio(id, destBase, opts) {
  const rights = await fetchRights(id, opts)
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(rights.glt))
  const userKey = await subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'decrypt'
  ])
  const rawKey = await unwrap(rights.key, id, userKey)
  const iv = await unwrap(rights.iv, id, userKey)
  if (iv.byteLength !== 16) throw new Error('Unwrapped IV must be 16 bytes')
  const contentKey = await subtle.importKey('raw', rawKey, { name: 'AES-CTR' }, false, [
    'decrypt'
  ])

  const res = await fetch(AUDIO_BASE_URL + encodeURIComponent(id) + '.m4a', {
    headers: { 'User-Agent': UA }
  })
  if (!res.ok || !res.body)
    throw new Error(`Encrypted audio request failed (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0

  let ext = null
  let file = null
  let done = 0
  const sink = new Transform({
    transform(chunk, _enc, cb) {
      if (!ext) {
        ext = sniffAudioExt(chunk)
        file = createWriteStream(`${destBase}.${ext}`)
        file.on('error', (e) => this.destroy(e))
      }
      done += chunk.length
      if (total && opts.progress) opts.progress(done / total)
      file.write(chunk, cb)
    },
    flush(cb) {
      if (file) file.end(cb)
      else cb(new Error('No audio data received'))
    }
  })
  await pipeline(Readable.fromWeb(res.body), ctrDecryptStream(contentKey, iv), sink)
  return `${destBase}.${ext}`
}

async function convertToMp3(src) {
  const dest = src.replace(/\.[^.]+$/, '.mp3')
  await execFileAsync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    src,
    '-vn',
    '-codec:a',
    'libmp3lame',
    '-q:a',
    '2',
    dest
  ])
  await unlink(src)
  return dest
}

async function downloadFile(url, dest, opts) {
  let res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://suno.com/' }
  }).catch(() => null)
  if (!res || !res.ok)
    res = await fetch(opts.proxy + encodeURIComponent(url), {
      headers: { 'User-Agent': UA }
    })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  return dest
}

// ---------- CLI ----------

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[^a-z0-9\u00c0-\uffff\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || ''
  )
}

function parseArgs(argv) {
  const o = {
    inputs: [],
    out: 'downloads',
    audio: true,
    video: false,
    cover: false,
    lyrics: false,
    json: false
  }
  o.proxy = DEFAULT_PROXY
  o.rightsUrl = DEFAULT_RIGHTS_URL
  o.origin = DEFAULT_ORIGIN
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') o.out = argv[++i]
    else if (a === '--proxy') o.proxy = argv[++i]
    else if (a === '--rights') o.rightsUrl = argv[++i]
    else if (a === '--origin') o.origin = argv[++i]
    else if (a === '--no-audio') o.audio = false
    else if (a === '--audio') o.audio = true
    else if (a === '--video') o.video = true
    else if (a === '--cover') o.cover = true
    else if (a === '--lyrics') o.lyrics = true
    else if (a === '--all') o.video = o.cover = o.lyrics = o.audio = true
    else if (a === '--json') o.json = true
    else if (a === '--mp3') o.mp3 = true
    else if (a === '-h' || a === '--help') o.help = true
    else o.inputs.push(a)
  }
  return o
}

function usage() {
  console.log(`Usage: suno-downloader <suno url|id> [...] [-o dir] [--video] [--cover] [--lyrics] [--all] [--mp3] [--json]
Accepts suno.com/song/<uuid>, suno.com/s/<short>, suno.com/hook/<uuid>, suno.com/playlist/<uuid> or a bare UUID.`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || !opts.inputs.length) {
    usage()
    process.exit(opts.help ? 0 : 1)
  }
  const clips = []
  for (const input of opts.inputs) clips.push(...(await resolveClips(input, opts)))
  if (opts.json) {
    console.log(JSON.stringify(clips, null, 2))
    return
  }
  await mkdir(opts.out, { recursive: true })
  let failures = 0
  for (const clip of clips) {
    const base = path.join(
      opts.out,
      `${slugify(clip.title) || clip.id}-${clip.id.slice(0, 8)}`
    )
    const who = clip.display_name || clip.handle || 'unknown'
    console.log(`\n${clip.title || clip.id}  —  ${who}  (${clip.id})`)
    const step = async (label, fn) => {
      try {
        const f = await fn()
        console.log(`  ${label}: ${f}`)
      } catch (e) {
        failures++
        console.error(`  ${label}: FAILED — ${e.message}`)
      }
    }
    if (opts.audio) {
      let last = -1
      await step('audio', () =>
        downloadAudio(clip.id, base, {
          ...opts,
          progress: (p) => {
            const pct = Math.floor(p * 10) * 10
            if (pct !== last && process.stdout.isTTY) {
              last = pct
              process.stdout.write(`\r  audio: ${pct}%   `)
            }
          }
        })
          .then((f) => (process.stdout.isTTY ? (process.stdout.write('\r'), f) : f))
          .then((f) => (opts.mp3 && !f.endsWith('.mp3') ? convertToMp3(f) : f))
      )
    }
    if (opts.video)
      await step('video', () => downloadFile(clip.video_url, `${base}.mp4`, opts))
    if (opts.cover)
      await step('cover', () =>
        downloadFile(clip.image_large_url, `${base}.jpeg`, opts).catch(() =>
          downloadFile(clip.image_url, `${base}.jpeg`, opts)
        )
      )
    if (opts.lyrics)
      await step('lyrics', async () => {
        const m = clip.metadata || {}
        const body = [
          clip.title || '',
          who ? `by ${who}` : '',
          m.tags ? `Style: ${m.tags}` : '',
          '',
          m.prompt || '[Instrumental]'
        ].join('\n')
        await writeFile(`${base}.txt`, body, 'utf8')
        return `${base}.txt`
      })
  }
  if (failures) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message || e)
    process.exit(1)
  })
}
