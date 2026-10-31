// Quick capture window: one text box. Enter appends it to the capture note (main decides where), Esc hides.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { errorText } from '../model'
import { t, setLanguage, type Language } from '../../shared/i18n'

interface Info { dark: boolean; accent: string; language: Language; target: 'daily' | 'inbox'; vault: string | null }

export function Capture() {
  const [info, setInfo] = useState<Info | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(
    () =>
      api.on('capture:show', (raw) => {
        const i = raw as Info
        setLanguage(i.language)
        document.body.classList.toggle('theme-dark', i.dark)
        document.body.classList.toggle('theme-light', !i.dark)
        document.body.style.setProperty('--accent', i.accent)
        setInfo(i)
        setError('')
        box.current?.focus()
      }),
    [],
  )

  const save = async () => {
    if (!text.trim()) return
    // cleared at once: a second Enter, or typing on, must not save the same text again
    setText('')
    try {
      await api.captureSave(text)
    } catch (e) {
      setText((cur) => text + cur)
      setError(errorText(e))
    }
  }

  return (
    <div className="capture" data-testid="capture">
      <textarea
        ref={box}
        autoFocus
        className="capture-input"
        value={text}
        placeholder={t('capture.placeholder')}
        aria-label={t('tray.capture')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') api.captureHide()
        }}
      />
      <div className={`capture-hint${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
        {error || (info && (info.vault ? t('capture.hint', { note: t(info.target === 'daily' ? 'capture.daily' : 'capture.inbox'), vault: info.vault }) : t('capture.noVault')))}
      </div>
    </div>
  )
}
