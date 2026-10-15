import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { model } from './model'
import { installHotkeys } from './commands'

installHotkeys()
model.init().catch((e) => console.error('init failed', e))
createRoot(document.getElementById('root')!).render(<App />)
