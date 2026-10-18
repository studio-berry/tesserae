import { useEffect, useRef, useState } from 'react'

export type ExportItem = { kind: 'text'; text: string } | { kind: 'png'; url: string }

// Shows what an export produced: the ASCII itself (with a copy button) or the PNG. Showing it
// instead of only downloading also works where downloads are blocked, such as embedded frames.
export function Export({ item, onClose }: { item: ExportItem; onClose: () => void }) {
  const pre = useRef<HTMLPreElement>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const copy = async () => {
    if (item.kind !== 'text') return
    try {
      await navigator.clipboard.writeText(item.text)
      setNote('Copied')
    } catch {
      // clipboard refused: select the text so the system copy command takes it
      const sel = getSelection(), range = document.createRange()
      if (pre.current && sel) { range.selectNodeContents(pre.current); sel.removeAllRanges(); sel.addRange(range) }
      setNote('Selected. Copy it with your system shortcut.')
    }
  }
  const save = () => {
    if (item.kind !== 'png') return
    const a = document.createElement('a')
    a.href = item.url; a.download = 'gen-ascii.png'
    document.body.appendChild(a); a.click(); a.remove()
  }
  const lines = item.kind === 'text' ? item.text.split('\n') : []

  return (
    <div className="export" role="dialog" aria-modal="true" aria-label={item.kind === 'text' ? 'Text export' : 'Image export'} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">
          <span>{item.kind === 'text' ? 'plain text' : 'png'}</span>
          <span>{item.kind === 'text' ? `${Math.max(...lines.map((l) => l.length))} × ${lines.length}` : 'long-press or right-click to save'}</span>
        </div>
        {item.kind === 'text'
          ? <pre ref={pre} className="ascii">{item.text}</pre>
          : <img className="shot" src={item.url} alt="The current view as an image" />}
        <div className="actions">
          {item.kind === 'text' ? <button type="button" onClick={copy}>copy</button> : <button type="button" onClick={save}>download</button>}
          <button type="button" onClick={onClose}>close</button>
          <span className="note" aria-live="polite">{note}</span>
        </div>
      </div>
    </div>
  )
}
