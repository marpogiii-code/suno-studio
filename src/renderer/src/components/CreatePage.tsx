import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  Clip,
  GenerateRequest,
  Persona,
  StylePreset
} from '../../../shared/types'
import { MODEL_VERSIONS } from '../lib/options'
import { unwrap } from '../lib/api'
import LyricEditor from './LyricEditor'
import StyleBuilder from './StyleBuilder'
import ClipCard from './ClipCard'

interface Props {
  settings: AppSettings
  personas: Persona[]
  extendTarget: Clip | null
  onClearExtend: () => void
  onSavePreset: (preset: StylePreset) => void
  onNotify: (msg: string, kind: 'error' | 'success') => void
  onCreditsChanged: () => void
}

const POLL_MS = 4000

export default function CreatePage({
  settings,
  personas,
  extendTarget,
  onClearExtend,
  onSavePreset,
  onNotify,
  onCreditsChanged
}: Props): JSX.Element {
  const [customMode, setCustomMode] = useState(true)
  const [title, setTitle] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [negativeTags, setNegativeTags] = useState('')
  const [voiceAnchor, setVoiceAnchor] = useState('warm vocals')
  const [modelVersion, setModelVersion] = useState(settings.defaultModelVersion)
  const [personaId, setPersonaId] = useState(settings.defaultPersonaId ?? '')
  const [instrumental, setInstrumental] = useState(false)
  const [styleWeight, setStyleWeight] = useState(0.6)
  const [weirdness, setWeirdness] = useState(0.3)
  const [continueClipId, setContinueClipId] = useState<string | null>(null)
  const [continueAt, setContinueAt] = useState(0)

  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<Clip[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (extendTarget) {
      setContinueClipId(extendTarget.id)
      setTitle(extendTarget.title)
      setTags(extendTarget.tags)
      setLyrics(extendTarget.prompt)
      setCustomMode(true)
      onClearExtend()
      onNotify(`Extending "${extendTarget.title}" — adjust and generate.`, 'success')
    }
  }, [extendTarget, onClearExtend, onNotify])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  function startPolling(ids: string[]): void {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const fresh = await unwrap(window.api.getClips(ids))
        setResults(fresh)
        const done = fresh.every(
          (c) => c.status === 'complete' || c.status === 'error'
        )
        if (done && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
          onCreditsChanged()
        }
      } catch {
        // transient; keep polling
      }
    }, POLL_MS)
  }

  async function generate(): Promise<void> {
    setGenerating(true)
    try {
      const req: GenerateRequest = {
        customMode,
        gptDescriptionPrompt: description,
        prompt: lyrics,
        tags,
        negativeTags,
        title: title || 'Untitled',
        modelVersion,
        makeInstrumental: instrumental,
        personaId: personaId || undefined,
        styleWeight,
        weirdnessConstraint: weirdness,
        continueClipId: continueClipId || undefined,
        continueAt: continueClipId ? continueAt : undefined
      }
      const clips = await unwrap(window.api.generate(req))
      setResults(clips)
      startPolling(clips.map((c) => c.id))
      onNotify('Generation started — clips will fill in below.', 'success')
      onCreditsChanged()
    } catch (err) {
      onNotify((err as Error).message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  function savePreset(): void {
    const name = window.prompt('Preset name?')
    if (!name) return
    onSavePreset({ name, tags, negativeTags, modelVersion })
    onNotify(`Preset "${name}" saved.`, 'success')
  }

  function applyPreset(name: string): void {
    const p = settings.presets.find((x) => x.name === name)
    if (!p) return
    setTags(p.tags)
    setNegativeTags(p.negativeTags)
    setModelVersion(p.modelVersion)
  }

  async function download(clip: Clip, format: 'mp3' | 'wav'): Promise<void> {
    try {
      const path = await unwrap(window.api.download(clip, format))
      onNotify(`Saved to ${path}`, 'success')
    } catch (err) {
      onNotify((err as Error).message, 'error')
    }
  }

  return (
    <div className="create-layout scroll">
      <div className="panel">
        <h2>Lyrics & structure</h2>

        <label className="toggle" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={customMode}
            onChange={(e) => setCustomMode(e.target.checked)}
          />
          Custom mode (write my own lyrics & style)
        </label>

        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
          />
        </label>

        {customMode ? (
          <>
            <label className="field">
              <span>Voice anchor (used by ⚓ re-anchor bridges)</span>
              <input
                type="text"
                value={voiceAnchor}
                onChange={(e) => setVoiceAnchor(e.target.value)}
                placeholder="e.g. warm female alto, breathy"
              />
            </label>
            <LyricEditor value={lyrics} onChange={setLyrics} voiceAnchor={voiceAnchor} />
          </>
        ) : (
          <label className="field">
            <span>Describe the song</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A dreamy lo-fi song about late nights in the city"
            />
          </label>
        )}

        {continueClipId && (
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="inline">
              <span className="group-label" style={{ margin: 0 }}>
                Extending clip {continueClipId.slice(0, 8)}…
              </span>
              <div className="spacer" />
              <button
                className="btn small"
                onClick={() => setContinueClipId(null)}
                type="button"
              >
                Cancel extend
              </button>
            </div>
            <label className="field" style={{ marginTop: 8 }}>
              <span>Continue at (seconds)</span>
              <input
                type="text"
                value={String(continueAt)}
                onChange={(e) => setContinueAt(Number(e.target.value) || 0)}
              />
            </label>
          </div>
        )}
      </div>

      <div>
        <div className="panel" style={{ marginBottom: 16 }}>
          <h2>Style</h2>
          {settings.presets.length > 0 && (
            <label className="field">
              <span>Apply preset</span>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && applyPreset(e.target.value)}
              >
                <option value="">Choose a preset…</option>
                {settings.presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <StyleBuilder
            tags={tags}
            onTagsChange={setTags}
            negativeTags={negativeTags}
            onNegativeChange={setNegativeTags}
          />
          <button className="btn small" type="button" onClick={savePreset}>
            ★ Save style as preset
          </button>
        </div>

        <div className="panel">
          <h2>Controls</h2>
          <div className="row">
            <label className="field">
              <span>Model</span>
              <select
                value={modelVersion}
                onChange={(e) => setModelVersion(e.target.value)}
              >
                {MODEL_VERSIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Persona</span>
              <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                <option value="">None</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="toggle" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={instrumental}
              onChange={(e) => setInstrumental(e.target.checked)}
            />
            Instrumental (no vocals)
          </label>

          <div className="slider-field">
            <div className="inline">
              <span className="group-label" style={{ margin: 0 }}>
                Style strength
              </span>
              <div className="spacer" />
              <span className="val">{styleWeight.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={styleWeight}
              onChange={(e) => setStyleWeight(Number(e.target.value))}
            />
          </div>

          <div className="slider-field">
            <div className="inline">
              <span className="group-label" style={{ margin: 0 }}>
                Weirdness
              </span>
              <div className="spacer" />
              <span className="val">{weirdness.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weirdness}
              onChange={(e) => setWeirdness(Number(e.target.value))}
            />
          </div>

          <button
            className="btn primary"
            style={{ width: '100%', marginTop: 6 }}
            onClick={generate}
            disabled={generating}
          >
            {generating ? 'Submitting…' : continueClipId ? 'Generate extension' : 'Generate'}
          </button>
          <p className="hint" style={{ marginTop: 8 }}>
            Suno shows a quick human-verification window on generate — solve it once and your
            track starts.
          </p>
        </div>

        {results.length > 0 && (
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Results</h2>
            <div className="clip-grid">
              {results.map((c) => (
                <ClipCard
                  key={c.id}
                  clip={c}
                  onDownload={download}
                  onExtend={(clip) => {
                    setContinueClipId(clip.id)
                    onNotify('Set as extend target above.', 'success')
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
