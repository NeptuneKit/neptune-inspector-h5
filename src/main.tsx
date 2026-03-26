import React from 'react'
import ReactDOM from 'react-dom/client'
import { initInspector } from '@linhey/react-debug-inspector'
import { AppRouter } from './app/AppRouter'
import './styles.css'

initInspector({})

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>,
)
