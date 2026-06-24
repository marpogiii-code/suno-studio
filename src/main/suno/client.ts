import type {
  Clip,
  ClipStatus,
  BillingInfo,
  GenerateRequest,
  Persona
} from '../../shared/types'
import type {
  ClerkClientResponse,
  ClerkTokenResponse,
  SunoBillingResponse,
  SunoGenerateResponse,
  SunoPersona,
  SunoPersonaListResponse,
  SunoRawClip
} from './types'

const STUDIO_BASE = 'https://studio-api.prod.suno.com'
const CLERK_BASE = 'https://clerk.suno.com'
const CLERK_JS_VERSION = '5.35.0'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** Thrown for any Suno API failure with a human-readable message. */
export class SunoError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'SunoError'
  }
}

/**
 * Minimal client for Suno's internal API. Authenticates with the user's own
 * browser session cookie via Clerk, then drives generation/library endpoints
 * on the user's behalf using their own account and credits.
 */
export class SunoClient {
  private cookie: string
  private jwt: string | null = null
  private jwtFetchedAt = 0
  private sessionId: string | null = null
  /** JWTs are short-lived; refresh well before the ~60s expiry. */
  private static readonly JWT_TTL_MS = 45_000

  constructor(cookie: string) {
    this.cookie = cookie.trim()
  }

  setCookie(cookie: string): void {
    const next = cookie.trim()
    if (next !== this.cookie) {
      this.cookie = next
      this.jwt = null
      this.sessionId = null
    }
  }

  hasCookie(): boolean {
    return this.cookie.length > 0
  }

  private clerkHeaders(): Record<string, string> {
    return {
      cookie: this.cookie,
      'user-agent': USER_AGENT,
      origin: 'https://suno.com',
      referer: 'https://suno.com/'
    }
  }

  private async resolveSessionId(): Promise<string> {
    if (this.sessionId) return this.sessionId
    const url = `${CLERK_BASE}/v1/client?_clerk_js_version=${CLERK_JS_VERSION}`
    const res = await fetch(url, { headers: this.clerkHeaders() })
    if (!res.ok) {
      throw new SunoError(
        `Could not read Suno session (HTTP ${res.status}). Your cookie may be expired — copy a fresh one from suno.com.`,
        res.status
      )
    }
    const body = (await res.json()) as ClerkClientResponse
    const sid =
      body.response?.last_active_session_id ?? body.response?.sessions?.[0]?.id
    if (!sid) {
      throw new SunoError(
        'No active Suno session found in the provided cookie. Make sure you are logged in at suno.com and copied the full cookie.'
      )
    }
    this.sessionId = sid
    return sid
  }

  /** Returns a valid bearer JWT, refreshing it from Clerk when stale. */
  private async getToken(): Promise<string> {
    const fresh = Date.now() - this.jwtFetchedAt < SunoClient.JWT_TTL_MS
    if (this.jwt && fresh) return this.jwt
    const sid = await this.resolveSessionId()
    const url = `${CLERK_BASE}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CLERK_JS_VERSION}`
    const res = await fetch(url, { method: 'POST', headers: this.clerkHeaders() })
    if (!res.ok) {
      // A 4xx here usually means the session id is stale; drop it so the next
      // call re-resolves from scratch.
      this.sessionId = null
      throw new SunoError(
        `Failed to refresh Suno auth token (HTTP ${res.status}). Try pasting a fresh cookie.`,
        res.status
      )
    }
    const body = (await res.json()) as ClerkTokenResponse
    if (!body.jwt) {
      throw new SunoError('Suno did not return an auth token. Cookie may be invalid.')
    }
    this.jwt = body.jwt
    this.jwtFetchedAt = Date.now()
    return this.jwt
  }

  private async api<T>(
    path: string,
    init?: { method?: string; body?: unknown }
  ): Promise<T> {
    const token = await this.getToken()
    const res = await fetch(`${STUDIO_BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        origin: 'https://suno.com',
        referer: 'https://suno.com/'
      },
      body: init?.body ? JSON.stringify(init.body) : undefined
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text
      try {
        const parsed = JSON.parse(text) as { detail?: string; message?: string }
        detail = parsed.detail ?? parsed.message ?? text
      } catch {
        // keep raw text
      }
      throw new SunoError(
        `Suno API ${path} failed (HTTP ${res.status}): ${detail || res.statusText}`,
        res.status
      )
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  /** Verifies the cookie works by fetching billing info. */
  async checkConnection(): Promise<BillingInfo> {
    return this.getBilling()
  }

  async getBilling(): Promise<BillingInfo> {
    const body = await this.api<SunoBillingResponse>('/api/billing/info/')
    return {
      creditsLeft: body.total_credits_left ?? body.credits ?? 0,
      monthlyLimit: body.monthly_limit ?? 0,
      monthlyUsage: body.monthly_usage ?? 0
    }
  }

  async listPersonas(): Promise<Persona[]> {
    try {
      const body = await this.api<SunoPersonaListResponse>('/api/personas/?page=0')
      return (body.personas ?? []).map(mapPersona)
    } catch {
      // Personas endpoint is optional / may change; don't hard-fail the app.
      return []
    }
  }

  async generate(req: GenerateRequest): Promise<Clip[]> {
    if (!req.turnstileToken) {
      throw new SunoError(
        'Missing human-verification token. Suno requires the verification check before generating.'
      )
    }
    const payload = buildGeneratePayload(req)
    const body = await this.api<SunoGenerateResponse>('/api/generate/v2-web/', {
      method: 'POST',
      body: payload
    })
    if (!body.clips || body.clips.length === 0) {
      throw new SunoError(
        body.detail ?? 'Suno accepted the request but returned no clips.'
      )
    }
    return body.clips.map(mapClip)
  }

  /** Fetches the current state of one or more clips by id. */
  async getClips(ids: string[]): Promise<Clip[]> {
    if (ids.length === 0) return []
    const body = await this.api<SunoRawClip[]>(
      `/api/feed/v2?ids=${encodeURIComponent(ids.join(','))}`
    )
    const arr = Array.isArray(body) ? body : []
    return arr.map(mapClip)
  }

  /** Fetches the most recent clips in the user's library. */
  async getLibrary(page = 0): Promise<Clip[]> {
    const body = await this.api<SunoRawClip[] | { clips?: SunoRawClip[] }>(
      `/api/feed/v2?page=${page}`
    )
    const arr = Array.isArray(body) ? body : (body.clips ?? [])
    return arr.map(mapClip)
  }
}

function buildGeneratePayload(req: GenerateRequest): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (req.personaId) metadata.persona_id = req.personaId
  if (typeof req.styleWeight === 'number') metadata.style_weight = req.styleWeight
  if (typeof req.weirdnessConstraint === 'number')
    metadata.weirdness_constraint = req.weirdnessConstraint

  // Mirror the field set the suno.com web client posts to /api/generate/v2-web/.
  const base: Record<string, unknown> = {
    token: req.turnstileToken,
    generation_type: 'TEXT',
    mv: req.modelVersion,
    title: req.title,
    make_instrumental: req.makeInstrumental,
    user_uploaded_images_b64: null,
    metadata,
    override_fields: [],
    cover_clip_id: null,
    persona_id: req.personaId ?? null,
    continue_clip_id: null,
    continue_at: null
  }

  if (req.customMode) {
    base.prompt = req.prompt
    base.tags = req.tags
    base.negative_tags = req.negativeTags ?? ''
  } else {
    base.gpt_description_prompt = req.gptDescriptionPrompt ?? ''
    base.prompt = ''
    base.tags = req.tags
  }

  if (req.continueClipId) {
    base.continue_clip_id = req.continueClipId
    base.continue_at = req.continueAt ?? 0
    base.task = 'extend'
  }
  return base
}

function normalizeStatus(status?: string): ClipStatus {
  switch (status) {
    case 'submitted':
      return 'submitted'
    case 'queued':
      return 'queued'
    case 'streaming':
      return 'streaming'
    case 'complete':
      return 'complete'
    case 'error':
      return 'error'
    default:
      return 'queued'
  }
}

function mapClip(raw: SunoRawClip): Clip {
  return {
    id: raw.id,
    title: raw.title ?? 'Untitled',
    status: normalizeStatus(raw.status),
    audioUrl: raw.audio_url ?? '',
    videoUrl: raw.video_url ?? '',
    imageUrl: raw.image_large_url ?? raw.image_url ?? '',
    createdAt: raw.created_at ?? '',
    durationSeconds: raw.metadata?.duration,
    tags: raw.metadata?.tags ?? '',
    prompt: raw.metadata?.prompt ?? '',
    modelVersion: raw.major_model_version ?? raw.model_name ?? '',
    errorMessage: raw.metadata?.error_message
  }
}

function mapPersona(raw: SunoPersona): Persona {
  return {
    id: raw.id,
    name: raw.name ?? 'Untitled persona',
    description: raw.description,
    imageUrl: raw.image_url ?? raw.root_clip?.image_url
  }
}
