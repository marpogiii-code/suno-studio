import type { Clip } from '../../../shared/types'

interface Props {
  clip: Clip
  onDownload: (clip: Clip, format: 'mp3' | 'wav') => void
  onExtend: (clip: Clip) => void
}

export default function ClipCard({ clip, onDownload, onExtend }: Props): JSX.Element {
  const ready = clip.status === 'complete' || clip.status === 'streaming'
  return (
    <div className="clip-card">
      {clip.imageUrl ? (
        <img src={clip.imageUrl} alt="" />
      ) : (
        <div className="clip-card-img-placeholder" />
      )}
      <div className="clip-meta">
        <div className="clip-title" title={clip.title}>
          {clip.title}
        </div>
        <div className="clip-tags" title={clip.tags}>
          {clip.tags || '—'}
        </div>
        <span className={`status ${clip.status}`}>{clip.status}</span>
        {clip.errorMessage && (
          <div className="hint" style={{ color: 'var(--bad)' }}>
            {clip.errorMessage}
          </div>
        )}
        {ready && clip.audioUrl && (
          <audio controls preload="none" src={clip.audioUrl} />
        )}
        <div className="clip-actions">
          <button
            className="btn small"
            disabled={!ready || !clip.audioUrl}
            onClick={() => onDownload(clip, 'mp3')}
          >
            ↓ MP3
          </button>
          <button
            className="btn small"
            disabled={!ready || !clip.audioUrl}
            onClick={() => onDownload(clip, 'wav')}
          >
            ↓ WAV
          </button>
          <button
            className="btn small"
            disabled={clip.status !== 'complete'}
            onClick={() => onExtend(clip)}
          >
            ⤳ Extend
          </button>
        </div>
      </div>
    </div>
  )
}
