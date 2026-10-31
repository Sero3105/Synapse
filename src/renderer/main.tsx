import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { model } from './model'
import { installHotkeys } from './commands'
import { Capture } from './components/Capture'

// the quick capture window loads this same page with #capture
if (location.hash === '#capture') createRoot(document.getElementById('root')!).render(<Capture />)
else {
  installHotkeys()
  model.init().catch((e) => console.error('init failed', e))
  createRoot(document.getElementById('root')!).render(<App />)
}
