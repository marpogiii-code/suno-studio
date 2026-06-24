import { useCallback, useEffect, useState } from 'react'
import type { Clip } from '../../../shared/types'
import { unwrap } from '../lib/api'
import ClipCard from './ClipCard'

interface Props {
  onNotify: (msg: string, kind: 'error' | 'success') => void
  onExtend: (clip: Clip) => void
}

export default function Library({ onNotify, onExtend }: Props): JSX.Element {
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await unwrap(window.api.getLibrary(0))
      setClips(data)
    } catch (err) {
      onNotify((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [onNotify])

  useEffect(() => {
    void load()
  }, [load])

  async function download(clip: Clip, format: 'mp3' | 'wav'): Promise<void> {
    try {
      const path = await unwrap(window.api.download(clip, format))
      onNotify(`Saved to ${path}`, 'success')
    } catch (err) {
      onNotify((err as Error).message, 'error')
    }
  }

  return (
    <div className="library scroll">
      <div className="inline" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Your library</h2>
        <div className="spacer" />
        <button className="btn small" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        <button className="btn small" onClick={() => window.api.openDownloadDir()}>
          Open downloads
        </button>
      </div>
      {clips.length === 0 && !loading ? (
        <div className="empty">
          No tracks yet. Generate something in the Create tab, or check your Suno
          cookie in Settings.
        </div>
      ) : (
        <div className="clip-grid">
          {clips.map((c) => (
            <ClipCard key={c.id} clip={c} onDownload={download} onExtend={onExtend} />
          ))}
        </div>
      )}
    </div>
  )
}
