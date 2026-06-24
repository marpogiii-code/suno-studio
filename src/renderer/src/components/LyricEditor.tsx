import { useRef } from 'react'
import { SECTION_TAGS, VOCAL_CUES } from '../lib/options'

interface Props {
  value: string
  onChange: (v: string) => void
  /** Voice descriptor used by the "re-anchor at bridge" helper. */
  voiceAnchor: string
}

export default function LyricEditor({ value, onChange, voiceAnchor }: Props): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  function insertAtCursor(text: string): void {
    const el = ref.current
    if (!el) {
      onChange(value + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  function insertSection(tag: string): void {
    const prefix = value.length && !value.endsWith('\n') ? '\n' : ''
    insertAtCursor(`${prefix}[${tag}]\n`)
  }

  function insertCue(cue: string): void {
    insertAtCursor(`[${cue}] `)
  }

  function reanchorBridges(): void {
    if (!voiceAnchor.trim()) return
    // Append the voice descriptor to any [Bridge] line that doesn't already
    // carry a parenthetical, since the bridge is the most common drift point.
    const anchored = value.replace(
      /^(\[Bridge\])\s*$/gim,
      `$1 (same vocalist, ${voiceAnchor.trim()})`
    )
    onChange(anchored)
  }

  return (
    <div>
      <div className="group-label">Section tags</div>
      <div className="chip-row">
        {SECTION_TAGS.map((t) => (
          <button key={t} className="chip" onClick={() => insertSection(t)} type="button">
            {t}
          </button>
        ))}
      </div>

      <div className="group-label">Vocal / production cues</div>
      <div className="chip-row">
        {VOCAL_CUES.map((c) => (
          <button key={c} className="chip" onClick={() => insertCue(c)} type="button">
            {c}
          </button>
        ))}
        <button
          className="chip"
          type="button"
          onClick={reanchorBridges}
          title="Append your voice descriptor to every [Bridge] line to reduce mid-song voice drift"
        >
          ⚓ re-anchor bridges
        </button>
      </div>

      <textarea
        ref={ref}
        className="lyrics"
        placeholder={'[Intro]\n\n[Verse 1]\n...\n\n[Chorus]\n...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
