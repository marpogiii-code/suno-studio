// Raw response shapes from Suno's internal (unofficial) API. Only the fields we
// consume are typed; the API returns many more.

export interface ClerkClientResponse {
  response?: {
    last_active_session_id?: string
    sessions?: Array<{ id: string }>
  }
}

export interface ClerkTokenResponse {
  jwt?: string
}

export interface SunoRawClip {
  id: string
  title?: string
  status?: string
  audio_url?: string
  video_url?: string
  image_url?: string
  image_large_url?: string
  created_at?: string
  model_name?: string
  major_model_version?: string
  metadata?: {
    tags?: string
    prompt?: string
    duration?: number
    error_message?: string
    error_type?: string
  }
}

export interface SunoGenerateResponse {
  id?: string
  clips?: SunoRawClip[]
  detail?: string
}

export interface SunoBillingResponse {
  total_credits_left?: number
  monthly_limit?: number
  monthly_usage?: number
  credits?: number
}

export interface SunoPersona {
  id: string
  name?: string
  description?: string
  image_url?: string
  root_clip?: { image_url?: string }
}

export interface SunoPersonaListResponse {
  personas?: SunoPersona[]
}
