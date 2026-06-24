import {
  ERAS,
  GENRES,
  INSTRUMENTS,
  MOODS,
  PRODUCTION,
  VOCALS
} from '../lib/options'

interface Props {
  tags: string
  onTagsChange: (v: string) => void
  negativeTags: string
  onNegativeChange: (v: string) => void
}

const GROUPS: Array<{ label: string; items: string[] }> = [
  { label: 'Genre', items: GENRES },
  { label: 'Mood', items: MOODS },
  { label: 'Vocals', items: VOCALS },
  { label: 'Instruments', items: INSTRUMENTS },
  { label: 'Era', items: ERAS },
  { label: 'Production', items: PRODUCTION }
]

function parseTags(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export default function StyleBuilder({
  tags,
  onTagsChange,
  negativeTags,
  onNegativeChange
}: Props): JSX.Element {
  const active = new Set(parseTags(tags).map((t) => t.toLowerCase()))

  function toggle(item: string): void {
    const current = parseTags(tags)
    const exists = current.some((t) => t.toLowerCase() === item.toLowerCase())
    const next = exists
      ? current.filter((t) => t.toLowerCase() !== item.toLowerCase())
      : [...current, item]
    onTagsChange(next.join(', '))
  }

  return (
    <div>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="group-label">{g.label}</div>
          <div className="chip-row">
            {g.items.map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${active.has(item.toLowerCase()) ? 'on' : ''}`}
                onClick={() => toggle(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ))}

      <label className="field">
        <span>Style string (editable — this is what Suno receives)</span>
        <textarea
          value={tags}
          onChange={(e) => onTagsChange(e.target.value)}
          placeholder="e.g. dark synthwave, 80s, analog synths, female vocals, moody"
        />
      </label>

      <label className="field">
        <span>Exclude styles</span>
        <input
          type="text"
          value={negativeTags}
          onChange={(e) => onNegativeChange(e.target.value)}
          placeholder="e.g. autotune, lo-fi, distortion"
        />
      </label>
    </div>
  )
}
