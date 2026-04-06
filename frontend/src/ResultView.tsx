import React, { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// pdf.js worker (Vite-friendly)
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type Project = { id: string; hasPdf: boolean; mappings: string[] }
type PdfRotation = 0 | 90 | 180 | 270

function updateResultUrl(projectId: string | null, templateName: string | null, mappingName: string | null) {
  const url = new URL(window.location.href)
  if (projectId) url.searchParams.set('project', projectId)
  else url.searchParams.delete('project')
  if (templateName) url.searchParams.set('template', templateName)
  else url.searchParams.delete('template')
  if (mappingName) url.searchParams.set('mapping', mappingName)
  else url.searchParams.delete('mapping')
  window.history.replaceState({}, '', url.toString())
}

export default function ResultView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pdfUrlRef = useRef<string | null>(null)
  const [pdf, setPdf] = useState<any>(null)
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(1)
  const [zoom, setZoom] = useState(1.25)
  const [pdfRotation, setPdfRotation] = useState<PdfRotation>(0)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 1000 })

  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<string[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [mappingName, setMappingName] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const mappings = projectId ? (projects.find(p => p.id === projectId)?.mappings ?? []) : []

  useEffect(() => {
    fetch('/api/projects')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load projects: ${r.status}`)
        return r.json()
      })
      .then((list: Project[]) => setProjects(list))
      .catch(err => {
        console.error(err)
        setProjects([])
      })
    fetch('/api/templates')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load templates: ${r.status}`)
        return r.json()
      })
      .then((list: string[]) => setTemplates(list))
      .catch(err => {
        console.error(err)
        setTemplates([])
      })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const proj = params.get('project')
    const mapping = params.get('mapping')
    const tpl = params.get('template')
    setProjectId(proj)
    setMappingName(mapping)
    setTemplateName(tpl)
  }, [])

  useEffect(() => {
    if (!projectId || mappings.length === 0) return
    if (!mappingName || !mappings.includes(mappingName)) {
      const first = mappings[0]
      setMappingName(first)
      updateResultUrl(projectId, templateName, first)
    }
  }, [projectId, mappings])

  async function doRender(proj: string, mapping: string, tpl: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: proj,
          templateName: tpl,
          mappingName: mapping
        })
      })
      if (!res.ok) {
        throw new Error(await res.text())
      }
      const blob = await res.blob()
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current)
      }
      const objectUrl = URL.createObjectURL(blob)
      pdfUrlRef.current = objectUrl
      const loadingTask = pdfjsLib.getDocument(objectUrl)
      const doc = await loadingTask.promise
      setPdf(doc)
      setNumPages(doc.numPages)
      setPageNum(1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render PDF')
    } finally {
      setLoading(false)
    }
  }

  function renderPdf() {
    if (!projectId || !mappingName) {
      setError('Missing project or mapping')
      return
    }
    const tpl = templateName || (templates.length > 0 ? templates[0] : null)
    if (!tpl) {
      setError('No templates in data/templates')
      return
    }
    if (!templateName && templates.length > 0) {
      setTemplateName(templates[0])
      updateResultUrl(projectId, templates[0], mappingName)
    }
    doRender(projectId, mappingName, tpl).catch(console.error)
  }

  useEffect(() => {
    if (!projectId || !mappingName || templates.length === 0) return
    if (!templateName) {
      setTemplateName(templates[0])
      updateResultUrl(projectId, templates[0], mappingName)
      return
    }
    doRender(projectId, mappingName, templateName).catch(console.error)
  }, [projectId, mappingName, templateName, templates])

  useEffect(() => {
    let cancelled = false
    if (!pdf || !canvasRef.current) return
    ;(async () => {
      const page = await pdf.getPage(pageNum)
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const viewport = page.getViewport({ scale: zoom, rotation: pdfRotation })
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const w = Math.floor(viewport.width)
      const h = Math.floor(viewport.height)
      canvas.width = w
      canvas.height = h
      setCanvasSize({ width: w, height: h })

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
    })().catch(console.error)
    return () => {
      cancelled = true
    }
  }, [pdf, pageNum, zoom, pdfRotation])

  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current)
      }
    }
  }, [])

  return (
    <div className="app">
      <aside className="panel-left">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const url = '/'
              window.location.href = url
            }}
          >
            ← Back to mapping
          </button>
        </div>
        <h1 className="logo">PDF Mapper – Result</h1>
        <div className="section">
          <span className="section-label">Context</span>
          <div className="form-group">
            <label>Project</label>
            <select
              className="select"
              value={projectId ?? ''}
              onChange={e => {
                const v = e.target.value || null
                setProjectId(v)
                updateResultUrl(v, templateName, mappingName)
              }}
            >
              <option value="">—</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.id}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Template</label>
            <select
              className="select"
              value={templateName ?? ''}
              onChange={e => {
                const v = e.target.value || null
                setTemplateName(v)
                updateResultUrl(projectId, v, mappingName)
              }}
            >
              <option value="">—</option>
              {templates.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Mapping</label>
            <select
              className="select"
              value={mappingName ?? ''}
              onChange={e => {
                const v = e.target.value || null
                setMappingName(v)
                updateResultUrl(projectId, templateName, v)
              }}
              disabled={!projectId || mappings.length === 0}
            >
              <option value="">—</option>
              {mappings.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={renderPdf}
            disabled={loading}
          >
            {loading ? 'Rendering…' : 'Render'}
          </button>
        </div>
        {error && <div className="hint" style={{ color: '#b91c1c' }}>{error}</div>}
      </aside>

      <div className="canvas-area">
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
      </div>

      <aside className="panel-right">
        <div className="section">
          <span className="section-label">Preview</span>
          {loading && <div className="hint">Rendering PDF…</div>}
          {!loading && !pdf && !error && <div className="hint">No PDF loaded yet</div>}
          {pdf && (
            <>
              <div className="section">
                <span className="section-label">Page</span>
                <div className="pager">
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setPageNum(p => Math.max(1, p - 1))}
                    disabled={pageNum <= 1}
                  >
                    ←
                  </button>
                  <span className="pager-value">
                    {pageNum} / {numPages}
                  </span>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => setPageNum(p => Math.min(numPages, p + 1))}
                    disabled={pageNum >= numPages}
                  >
                    →
                  </button>
                </div>
              </div>
              <div className="section">
                <span className="section-label">Zoom</span>
                <div className="pager">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.1) * 100) / 100))}
                  >
                    −
                  </button>
                  <span className="pager-value">{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    onClick={() => setZoom(z => Math.min(4, Math.round((z + 0.1) * 100) / 100))}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="section">
                <span className="section-label">Rotation</span>
                <select
                  className="select"
                  value={pdfRotation}
                  onChange={e => setPdfRotation(Number(e.target.value) as PdfRotation)}
                >
                  <option value={0}>0°</option>
                  <option value={90}>90°</option>
                  <option value={180}>180°</option>
                  <option value={270}>270°</option>
                </select>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

