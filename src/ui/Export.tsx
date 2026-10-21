import { useEffect, useRef, useState } from 'react'
import { creditText, scanCredit, type Credit } from '../objects/credit'
import { scanLine } from '../safety'

export type ExportItem = { kind: 'text'; text: string } | { kind: 'png'; url: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'gen-ascii'

// A whole text export: the header, the credit and the art. Every word is scanned, because the
// title, the author and the licence of a searched model all come from a third party. The link is
// the one thing left alone, because a link that was scanned would point at nothing.
export const exportText = (body: string, caption: string, credit: Credit | null, ramp: string) => {
  const lines = [`# gen-ascii · ${scanLine(caption, ramp)}`]
  const c = scanCredit(credit, ramp)
  if (c.words) lines.push(`# ${c.words} · ${c.url}`)
  lines.push(body.split('\n').map((l) => scanLine(l, ramp)).join('\n'))
  return lines.join('\n')
}

// Shows what an export produced: the ASCII itself (with a copy button) or the PNG. Showing it
// instead of only downloading also works where downloads are blocked, such as embedded frames.
export function Export({ item, onClose, caption, credit }: { item: ExportItem; onClose: () => void; caption?: string; credit?: string }) {
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
      setNote('copied')
    } catch {
      // clipboard refused: select the text so the system copy command takes it
      const sel = getSelection(), range = document.createRange()
      if (pre.current && sel) { range.selectNodeContents(pre.current); sel.removeAllRanges(); sel.addRange(range) }
      setNote('selected. copy it with your system shortcut.')
    }
  }
  const save = () => {
    if (item.kind !== 'png') return
    const a = document.createElement('a')
    a.href = item.url; a.download = `${slug(caption ?? 'gen-ascii')}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  const lines = item.kind === 'text' ? item.text.split('\n') : []
  // embedded frames usually refuse downloads; there the image itself is the way to save
  const embedded = window.self !== window.top

  return (
    <div className="export" role="dialog" aria-modal="true" aria-label={item.kind === 'text' ? 'text export' : 'image export'} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">
          <span>{item.kind === 'text' ? 'plain text' : 'png'}</span>
          <span>{item.kind === 'text' ? `${Math.max(...lines.map((l) => l.length))} × ${lines.length}` : 'long-press or right-click to save'}</span>
        </div>
        {item.kind === 'text'
          ? <pre ref={pre} className="ascii">{item.text}</pre>
          : <img className="shot" src={item.url} alt="the current view as an image" />}
        <p className="caption">{caption ?? 'gen-ascii'}</p>
        {credit && <p className="credit">{credit}</p>}
        <div className="actions">
          {item.kind === 'text' ? <button type="button" onClick={copy}>copy</button> : !embedded && <button type="button" onClick={save}>download</button>}
          <button type="button" onClick={onClose}>close</button>
          <span className="note" aria-live="polite">{note}</span>
        </div>
      </div>
    </div>
  )
}
