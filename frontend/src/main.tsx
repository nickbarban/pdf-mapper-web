import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import ResultView from './ResultView'

const path = window.location.pathname
const Root = path.startsWith('/result') ? ResultView : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
