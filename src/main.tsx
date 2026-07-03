import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { initPlugins } from './plugins'
import { useStore, ADOPT_TOKEN, setTabCounterBase } from './store'
import './index.css'

initPlugins()

function render() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
}

// Detached window (tab tear-out): adopt the handed-off tab before first render so
// the default tab never mounts (and never spawns an orphan PTY).
if (ADOPT_TOKEN && window.fterm?.consumeAdoptedTab) {
  window.fterm.consumeAdoptedTab(ADOPT_TOKEN)
    .then((payload) => {
      if (payload?.tab) {
        setTabCounterBase(payload.seqOffset)
        // Inherit the origin window's look + config (theme, fonts, welcome-seen, …).
        const snap = payload.snapshot ?? {}
        useStore.setState({
          ...snap,
          tabs: [payload.tab],
          activeTabId: payload.tab.id,
          activeView: 'terminal',
        })
      }
    })
    .catch(() => { })
    .finally(render)
} else {
  render()
}
