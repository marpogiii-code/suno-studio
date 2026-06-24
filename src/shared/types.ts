export interface GenerateRequest {
  /** Whether to use custom mode (explicit lyrics + style) or simple prompt mode. */
  customMode: boolean
  /** Free-form description used in simple (non-custom) mode. */
  gptDescriptionPrompt?: string
  /** Lyrics for custom mode (with section tags etc.). */
  prompt: string
  /** Style descriptors, comma separated (the "tags" field in Suno's API). */
  tags: string
  /** Styles to exclude from the generation. */
  negativeTags?: string
  /** Song title. */
  title: string
  /** Model version, e.g. "chirp-v3-5" / "chirp-bluejay". */
  modelVersion: string
  /** If true, generate an instrumental track with no vocals. */
  makeInstrumental: boolean
  /** Optional persona id to anchor the voice. */
  personaId?: string
  /** Style strength / weirdness controls (0..1) when supported by the model. */
  styleWeight?: number
  weirdnessConstraint?: number
  /** Continuation: clip id and start time when extending an existing clip. */
  continueClipId?: string
  continueAt?: number
}

export type ClipStatus = 'submitted' | 'queued' | 'streaming' | 'complete' | 'error'

export interface Clip {
  id: string
  title: string
  status: ClipStatus
  audioUrl: string
  videoUrl: string
  imageUrl: string
  createdAt: string
  durationSeconds?: number
  tags: string
  prompt: string
  modelVersion: string
  errorMessage?: string
}

export interface Persona {
  id: string
  name: string
  description?: string
  imageUrl?: string
}

export interface BillingInfo {
  creditsLeft: number
  monthlyLimit: number
  monthlyUsage: number
}

export interface AppSettings {
  /** The Suno session cookie copied from the browser. */
  sunoCookie: string
  defaultModelVersion: string
  defaultPersonaId?: string
  /** Local directory where downloaded audio is saved. */
  downloadDir: string
  /** Saved style presets keyed by name. */
  presets: StylePreset[]
}

export interface StylePreset {
  name: string
  tags: string
  negativeTags: string
  modelVersion: string
}

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}
