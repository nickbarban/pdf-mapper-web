import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Transformer } from 'react-konva'
import * as pdfjsLib from 'pdfjs-dist'

// pdf.js worker (Vite-friendly)
// @ts-ignore
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type Project = { id: string; hasPdf: boolean; mappings: string[] }

export type FieldValue = { parsed?: string; custom?: string }

export type Field = {
  id: string
  name: string
  type?: string
  page: number
  x: number
  y: number
  w: number
  h: number
  value?: FieldValue
}

type NormalizedMapping = { fields: Field[] }

function uid(prefix = 'f') {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function normalizeMapping(raw: any): NormalizedMapping {
  const arr = Array.isArray(raw)
    ? raw
    : raw?.fields ?? raw?.mappings ?? raw?.items ?? raw?.rects ?? []

  const fields: Field[] = (Array.isArray(arr) ? arr : []).map((it: any, idx: number) => {
    const page = Number(it.page ?? it.pageNumber ?? it.pageno ?? 1)
    const x = Number(it.x ?? it.left ?? it.l ?? it.rect?.x ?? it.bbox?.x ?? 0)
    const y = Number(it.y ?? it.top ?? it.t ?? it.rect?.y ?? it.bbox?.y ?? 0)
    const w = Number(it.w ?? it.width ?? it.rect?.w ?? it.rect?.width ?? it.bbox?.w ?? it.bbox?.width ?? 0)
    const h = Number(it.h ?? it.height ?? it.rect?.h ?? it.rect?.height ?? it.bbox?.h ?? it.bbox?.height ?? 0)

    const rawVal = it.value
    let value: FieldValue | undefined
    if (rawVal != null) {
      if (typeof rawVal === 'object' && !Array.isArray(rawVal)) {
        value = { parsed: rawVal.parsed, custom: rawVal.custom }
      } else {
        value = { parsed: String(rawVal) }
      }
    }
    return {
      id: String(it.id ?? it.fieldId ?? it.key ?? uid(`f${idx}`)),
      name: String(it.name ?? it.fieldName ?? it.label ?? `field_${idx + 1}`),
      type: it.type ?? it.fieldType,
      page: Number.isFinite(page) ? page : 1,
      x, y, w, h,
      value
    }
  })

  return { fields }
}

function denormalizeMapping(mapping: NormalizedMapping) {
  return {
    schema: 'pdf-mapper-web:v1',
    fields: mapping.fields.map(f => {
      const { value, ...rest } = f
      const hasValue = value && (value.parsed != null || value.custom != null)
      return {
        ...rest,
        type: f.type === 'numeric' || f.type === 'checkbox' ? f.type : 'text',
        ...(hasValue ? { value: { parsed: value!.parsed, custom: value!.custom } } : {})
      }
    })
  }
}

function fieldDisplayValue(v: FieldValue | undefined): string {
  if (!v) return ''
  return (v.custom ?? v.parsed ?? '').trim()
}

async function extractTextFromField(
  pdfDoc: any,
  field: Field,
  rotation: PdfRotation
): Promise<string> {
  const page = await pdfDoc.getPage(field.page)
  const viewport = page.getViewport({ scale: 1, rotation })
  const textContent = await page.getTextContent()

  const corners = [
    [field.x, field.y],
    [field.x + field.w, field.y],
    [field.x, field.y + field.h],
    [field.x + field.w, field.y + field.h]
  ]
  const pdfPoints = corners.map(([vx, vy]) => viewport.convertToPdfPoint(vx, vy))
  const pdfXMin = Math.min(...pdfPoints.map(p => p[0]))
  const pdfXMax = Math.max(...pdfPoints.map(p => p[0]))
  const pdfYMin = Math.min(...pdfPoints.map(p => p[1]))
  const pdfYMax = Math.max(...pdfPoints.map(p => p[1]))

  const items: { str: string; x: number; y: number }[] = []
  const eps = 0.5
  for (const item of textContent.items as any[]) {
    const tx = item.transform?.[4] ?? item.transform?.tx ?? 0
    const ty = item.transform?.[5] ?? item.transform?.ty ?? 0
    const tw = Math.abs(item.width ?? 0)
    const th = Math.abs(item.height ?? 0)
    const itemRight = tx + tw
    const itemTop = ty + th
    const strictlyInsideX = tx >= pdfXMin - eps && itemRight <= pdfXMax + eps
    const strictlyInsideY = ty >= pdfYMin - eps && itemTop <= pdfYMax + eps
    if (strictlyInsideX && strictlyInsideY) {
      items.push({ str: item.str ?? '', x: tx, y: ty })
    }
  }
  items.sort((a, b) => {
    const dy = b.y - a.y
    if (Math.abs(dy) > 3) return dy
    return a.x - b.x
  })
  return items.map(i => i.str).join('').trim()
}

function strokeColorForType(type: string | undefined, isSelected: boolean): string {
  if (isSelected) return 'orange'
  switch (type) {
    case 'numeric':
      return '#2563eb'
    case 'checkbox':
      return '#9333ea'
    case 'text':
    default:
      return '#16a34a'
  }
}

type PdfRotation = 0 | 90 | 180 | 270

function fieldToCanvas(
  f: Field,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  rotation: PdfRotation
): { x: number; y: number; w: number; h: number } {
  const w = f.w * zoom
  const h = f.h * zoom
  const x = f.x * zoom
  const y = f.y * zoom
  switch (rotation) {
    case 90:
      return { x: canvasWidth - (f.y + f.h) * zoom, y: f.x * zoom, w: h, h: w }
    case 180:
      return {
        x: canvasWidth - (f.x + f.w) * zoom,
        y: canvasHeight - (f.y + f.h) * zoom,
        w,
        h
      }
    case 270:
      return { x: f.y * zoom, y: canvasHeight - (f.x + f.w) * zoom, w: h, h: w }
    default:
      return { x, y, w, h }
  }
}

function canvasToField(
  canvasX: number,
  canvasY: number,
  canvasW: number,
  canvasH: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  rotation: PdfRotation
): { x: number; y: number; w: number; h: number } {
  const w = canvasW / zoom
  const h = canvasH / zoom
  switch (rotation) {
    case 90:
      return {
        x: canvasY / zoom,
        y: (canvasWidth - canvasX - canvasW) / zoom,
        w: h,
        h: w
      }
    case 180:
      return {
        x: (canvasWidth - canvasX - canvasW) / zoom,
        y: (canvasHeight - canvasY - canvasH) / zoom,
        w,
        h
      }
    case 270:
      return {
        x: (canvasHeight - canvasY - canvasH) / zoom,
        y: canvasX / zoom,
        w: h,
        h: w
      }
    default:
      return {
        x: canvasX / zoom,
        y: canvasY / zoom,
        w,
        h
      }
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const shapeRef = useRef<any>(null)
  const trRef = useRef<any>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string>('project1')

  const [mappingName, setMappingName] = useState<string>('runA')

  const [pdf, setPdf] = useState<any>(null)
  const [pageNum, setPageNum] = useState<number>(1)
  const [numPages, setNumPages] = useState<number>(1)
  const [zoom, setZoom] = useState<number>(1.25)
  const [pdfRotation, setPdfRotation] = useState<PdfRotation>(0)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 1000 })

  const [mapping, setMapping] = useState<NormalizedMapping>({ fields: [] })
  const [history, setHistory] = useState<NormalizedMapping[]>([])
  const [redoStack, setRedoStack] = useState<NormalizedMapping[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mappingRef = useRef<NormalizedMapping>({ fields: [] })
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0)
  const [parsing, setParsing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [modalPos, setModalPos] = useState({ x: 10, y: 10 })
  const dragRef = useRef<{ startX: number; startY: number; clientX: number; clientY: number } | null>(null)

  const selectedField = useMemo(
    () => mapping.fields.find(f => f.id === selectedId) ?? null,
    [mapping.fields, selectedId]
  )

  useEffect(() => {
    mappingRef.current = mapping
  }, [mapping])

  useEffect(() => {
    if (selectedField) setModalPos({ x: 10, y: 10 })
  }, [selectedId])

  useEffect(() => {
    if (!selectedField) return
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const d = dragRef.current
      setModalPos(p => ({
        x: Math.max(0, p.x + e.clientX - d.clientX),
        y: Math.max(0, p.y + e.clientY - d.clientY)
      }))
      dragRef.current = { ...d, clientX: e.clientX, clientY: e.clientY }
    }
    const onUp = () => { dragRef.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [selectedField])

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    dragRef.current = { startX: modalPos.x, startY: modalPos.y, clientX: e.clientX, clientY: e.clientY }
  }

  const maxHistory = 50

  function applyChange(updater: (prev: NormalizedMapping) => NormalizedMapping) {
    setHistory(h => [...h.slice(-(maxHistory - 1)), mappingRef.current])
    setRedoStack([])
    setMapping(updater)
  }

  function undo() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setRedoStack(r => [...r.slice(-(maxHistory - 1)), mappingRef.current])
    setHistory(h => h.slice(0, -1))
    setMapping(prev)
    setSelectedId(prev.fields.some(f => f.id === selectedId) ? selectedId : prev.fields[0]?.id ?? null)
  }

  function redo() {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setHistory(h => [...h.slice(-(maxHistory - 1)), mappingRef.current])
    setRedoStack(r => r.slice(0, -1))
    setMapping(next)
    setSelectedId(next.fields.some(f => f.id === selectedId) ? selectedId : next.fields[0]?.id ?? null)
  }

  function refreshProjects() {
    return fetch('/api/projects')
      .then(r => r.json())
      .then((list: Project[]) => {
        setProjects(list)
        if (!list.find(p => p.id === projectId) && list.length) {
          setProjectId(list[0].id)
        }
        return list
      })
      .catch(() => setProjects([]))
  }

  useEffect(() => {
    refreshProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!projectId) return
    ;(async () => {
      const loadingTask = pdfjsLib.getDocument(`/api/project/${encodeURIComponent(projectId)}/pdf?t=${pdfRefreshKey}`)
      const doc = await loadingTask.promise
      setPdf(doc)
      setNumPages(doc.numPages)
      setPageNum(1)
    })().catch(err => {
      console.error(err)
      setPdf(null)
    })
  }, [projectId, pdfRefreshKey])

  useEffect(() => {
    if (!projectId || !mappingName) return
    fetch(`/api/project/${encodeURIComponent(projectId)}/mapping?name=${encodeURIComponent(mappingName)}`)
      .then(r => r.json())
      .then(raw => {
        const nm = normalizeMapping(raw)
        setMapping(nm)
        setHistory([])
        setRedoStack([])
        setSelectedId(nm.fields[0]?.id ?? null)
      })
      .catch(err => {
        console.error(err)
        setMapping({ fields: [] })
        setHistory([])
        setRedoStack([])
        setSelectedId(null)
      })
  }, [projectId, mappingName])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    ;(async () => {
      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: zoom, rotation: pdfRotation })
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!

      const w = Math.floor(viewport.width)
      const h = Math.floor(viewport.height)
      canvas.width = w
      canvas.height = h
      setCanvasSize({ width: w, height: h })

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
    })().catch(console.error)
  }, [pdf, pageNum, zoom, pdfRotation])

  const pageFields = useMemo(() => mapping.fields.filter(f => f.page === pageNum), [mapping.fields, pageNum])

  const stageSize = useMemo(
    () => ({ width: canvasSize.width, height: canvasSize.height }),
    [canvasSize.width, canvasSize.height]
  )

  useEffect(() => {
    if (selectedId && shapeRef.current && trRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [selectedId, pageFields])

  useEffect(() => {
    if (!pdf || !selectedField) return
    const id = selectedField.id
    extractTextFromField(pdf, selectedField, pdfRotation)
      .then(parsed => {
        setMapping(prev => {
          const f = prev.fields.find(ff => ff.id === id)
          if (!f || f.value?.parsed === parsed) return prev
          return {
            fields: prev.fields.map(ff =>
              ff.id === id ? { ...ff, value: { ...ff.value, parsed } } : ff
            )
          }
        })
      })
      .catch(() => {})
  }, [pdf, selectedField, pdfRotation])

  async function save() {
    const body = denormalizeMapping(mapping)
    const res = await fetch(`/api/project/${encodeURIComponent(projectId)}/mapping?name=${encodeURIComponent(mappingName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(await res.text())
    setHistory([])
    setRedoStack([])
  }

  async function saveAs() {
    const to = prompt('New mapping name (without .json):', `${mappingName}_fixed`)
    if (!to) return
    // write directly
    const body = denormalizeMapping(mapping)
    const res = await fetch(`/api/project/${encodeURIComponent(projectId)}/mapping?name=${encodeURIComponent(to)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(await res.text())

    setHistory([])
    setRedoStack([])
    // refresh projects list + select new mapping
    const list: Project[] = await fetch('/api/projects').then(r => r.json())
    setProjects(list)
    setMappingName(to)
  }

  function updateSelected(patch: Partial<Field>) {
    if (!selectedId) return
    setMapping(prev => ({
      fields: prev.fields.map(f => (f.id === selectedId ? { ...f, ...patch } : f))
    }))
  }

  async function createProject() {
    const name = prompt('Project name (letters, numbers, - and _ only):', '')
    if (!name?.trim()) return
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      alert('Invalid name. Use only letters, numbers, - and _')
      return
    }
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: name })
      })
      if (!res.ok) throw new Error(await res.text())
      await refreshProjects()
      setProjectId(name)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create project')
    }
  }

  async function uploadPdf(file: File) {
    if (!file.type.includes('pdf')) {
      alert('Please select a PDF file')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/project/${encodeURIComponent(projectId)}/pdf`, {
        method: 'POST',
        body: form
      })
      if (!res.ok) throw new Error(await res.text())
      await refreshProjects()
      setPdf(null)
      setPdfRefreshKey(k => k + 1)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to upload PDF')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function deleteSelected() {
    if (!selectedId) return
    applyChange(prev => ({ fields: prev.fields.filter(f => f.id !== selectedId) }))
    setSelectedId(null)
  }

  function addField(x: number, y: number, w: number, h: number) {
    const minSize = 15
    const nx = Math.min(x, x + w)
    const ny = Math.min(y, y + h)
    const nw = Math.max(Math.abs(w), minSize / zoom)
    const nh = Math.max(Math.abs(h), minSize / zoom)
    const newField: Field = {
      id: uid('f'),
      name: `field_${mapping.fields.length + 1}`,
      type: 'text',
      page: pageNum,
      x: nx,
      y: ny,
      w: nw,
      h: nh
    }
    applyChange(prev => ({ fields: [...prev.fields, newField] }))
    setSelectedId(newField.id)
  }

  function getDrawPreview() {
    if (!drawStart || !drawCurrent) return null
    const x = Math.min(drawStart.x, drawCurrent.x)
    const y = Math.min(drawStart.y, drawCurrent.y)
    const w = Math.abs(drawCurrent.x - drawStart.x)
    const h = Math.abs(drawCurrent.y - drawStart.y)
    return { x, y, w, h }
  }

  async function parseTextInFields() {
    if (!pdf || pageFields.length === 0) return
    setParsing(true)
    try {
      const updates: { id: string; parsed: string }[] = []
      for (const f of pageFields) {
        const parsed = await extractTextFromField(pdf, f, pdfRotation)
        updates.push({ id: f.id, parsed })
      }
      applyChange(prev => ({
        fields: prev.fields.map(ff => {
          const u = updates.find(x => x.id === ff.id)
          return u ? { ...ff, value: { ...ff.value, parsed: u.parsed } } : ff
        })
      }))
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : 'Failed to parse text')
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className="app">
      <aside className="panel-left">
        <h1 className="logo">PDF Mapper</h1>

        <div className="section">
          <span className="section-label">Project</span>
          <div className="btn-row">
            <select className="select" value={projectId} onChange={e => setProjectId(e.target.value)} style={{ flex: 1 }}>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-icon" onClick={createProject} title="New project">
              +
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) uploadPdf(f)
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !projectId}
          style={{ width: '100%' }}
        >
          {uploading ? 'Uploading…' : 'Load PDF from file…'}
        </button>

        <div className="section">
          <span className="section-label">Mapping</span>
          <select className="select" value={mappingName} onChange={e => setMappingName(e.target.value)}>
            {(projects.find(p => p.id === projectId)?.mappings ?? []).map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => save().then(() => alert('Saved'))} style={{ flex: 1 }}>Save</button>
            <button className="btn btn-ghost" onClick={() => saveAs().then(() => alert('Saved as'))}>Save as…</button>
          </div>
        </div>

        <div className="section">
          <span className="section-label">Page</span>
          <div className="pager">
            <button className="btn btn-ghost btn-icon" onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={pageNum <= 1}>
              ←
            </button>
            <span className="pager-value">{pageNum} / {numPages}</span>
            <button className="btn btn-ghost btn-icon" onClick={() => setPageNum(p => Math.min(numPages, p + 1))} disabled={pageNum >= numPages}>
              →
            </button>
          </div>
        </div>

        <div className="section">
          <span className="section-label">Zoom</span>
          <div className="pager">
            <button className="btn btn-ghost btn-icon" onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.1) * 100) / 100))}>−</button>
            <span className="pager-value">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-ghost btn-icon" onClick={() => setZoom(z => Math.min(4, Math.round((z + 0.1) * 100) / 100))}>+</button>
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

        <div className="btn-row">
          <button className="btn btn-ghost" onClick={undo} disabled={history.length === 0} title="Undo">Undo</button>
          <button className="btn btn-ghost" onClick={redo} disabled={redoStack.length === 0} title="Redo">Redo</button>
        </div>

        <p className="hint">Drag on empty canvas to add a new field</p>
      </aside>

      <div className="canvas-area">
        {selectedField && (
          <div
            className="modal-selection"
            style={{ left: modalPos.x, top: modalPos.y }}
          >
            <div className="modal-selection-header" onMouseDown={startDrag}>
              <span className="section-label">Selected field</span>
              <button type="button" className="btn btn-ghost btn-icon" onMouseDown={e => e.stopPropagation()} onClick={() => setSelectedId(null)} title="Close">×</button>
            </div>
            <div className="modal-selection-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="form-group">
                  <label>Name</label>
                  <input className="input" value={selectedField.name} onChange={e => updateSelected({ name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Parsed</label>
                  <input
                    className="input"
                    value={selectedField.value?.parsed ?? ''}
                    readOnly
                    placeholder="Extracted from PDF"
                  />
                </div>
                <div className="form-group">
                  <label>Custom</label>
                  <input
                    className="input"
                    value={selectedField.value?.custom ?? ''}
                    onChange={e => updateSelected({ value: { ...selectedField.value, custom: e.target.value } })}
                    placeholder="Override or manual value"
                  />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select
                    className="select"
                    value={selectedField.type === 'numeric' || selectedField.type === 'checkbox' ? selectedField.type : 'text'}
                    onChange={e => updateSelected({ type: e.target.value })}
                  >
                    <option value="numeric">numeric</option>
                    <option value="text">text</option>
                    <option value="checkbox">checkbox</option>
                  </select>
                </div>
                <button type="button" className="btn btn-danger" onClick={deleteSelected}>
                  Delete field
                </button>
                <div className="form-grid">
                  <div className="form-group">
                    <label>x</label>
                    <input className="input" type="number" value={selectedField.x} onChange={e => updateSelected({ x: Number(e.target.value) })} />
                  </div>
                  <div className="form-group">
                    <label>y</label>
                    <input className="input" type="number" value={selectedField.y} onChange={e => updateSelected({ y: Number(e.target.value) })} />
                  </div>
                  <div className="form-group">
                    <label>w</label>
                    <input className="input" type="number" value={selectedField.w} onChange={e => updateSelected({ w: Number(e.target.value) })} />
                  </div>
                  <div className="form-group">
                    <label>h</label>
                    <input className="input" type="number" value={selectedField.h} onChange={e => updateSelected({ h: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} style={{ display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0 }}>
            <Stage
              width={stageSize.width}
              height={stageSize.height}
              onMouseMove={e => {
                if (!isDrawing) return
                const pos = e.target.getStage()?.getPointerPosition()
                if (pos) setDrawCurrent(pos)
              }}
              onMouseUp={() => {
                if (!isDrawing || !drawStart || !drawCurrent) return
                const preview = getDrawPreview()
                if (preview && preview.w >= 10 && preview.h >= 10) {
                  const { x, y, w, h } = canvasToField(
                    preview.x, preview.y, preview.w, preview.h,
                    zoom, stageSize.width, stageSize.height, pdfRotation
                  )
                  addField(x, y, w, h)
                }
                setIsDrawing(false)
                setDrawStart(null)
                setDrawCurrent(null)
              }}
              onMouseLeave={() => {
                if (isDrawing) {
                  setIsDrawing(false)
                  setDrawStart(null)
                  setDrawCurrent(null)
                }
              }}
            >
              <Layer>
                <Rect
                  width={stageSize.width}
                  height={stageSize.height}
                  fill="transparent"
                  listening
                  onMouseDown={e => {
                    const pos = e.target.getStage()?.getPointerPosition()
                    if (pos) {
                      setIsDrawing(true)
                      setDrawStart(pos)
                      setDrawCurrent(pos)
                      setSelectedId(null)
                    }
                  }}
                />
                {(() => {
                  const p = getDrawPreview()
                  return p ? (
                    <Rect
                      x={p.x}
                      y={p.y}
                      width={p.w}
                      height={p.h}
                      stroke="#6366f1"
                      strokeWidth={2}
                      dash={[4, 4]}
                      listening={false}
                    />
                  ) : null
                })()}
                {pageFields.map(f => {
                  const isSel = f.id === selectedId
                  const pos = fieldToCanvas(f, zoom, stageSize.width, stageSize.height, pdfRotation)
                  return (
                    <Rect
                      key={f.id}
                      ref={isSel ? shapeRef : undefined}
                      x={pos.x}
                      y={pos.y}
                      width={pos.w}
                      height={pos.h}
                      fill="rgba(0,0,0,0.01)"
                      strokeWidth={isSel ? 3 : 2}
                      stroke={strokeColorForType(f.type, isSel)}
                      draggable
                      listening
                      onClick={() => setSelectedId(f.id)}
                      onTap={() => setSelectedId(f.id)}
                      onDragEnd={e => {
                        const { x: nx, y: ny } = canvasToField(
                          e.target.x(), e.target.y(), e.target.width(), e.target.height(),
                          zoom, stageSize.width, stageSize.height, pdfRotation
                        )
                        applyChange(prev => ({
                          fields: prev.fields.map(ff => (ff.id === f.id ? { ...ff, x: nx, y: ny } : ff))
                        }))
                      }}
                      onTransformEnd={() => {
                        const node = shapeRef.current
                        if (!node || !selectedId) return
                        const scaleX = node.scaleX()
                        const scaleY = node.scaleY()
                        node.scaleX(1)
                        node.scaleY(1)
                        const { x: nx, y: ny, w: nw, h: nh } = canvasToField(
                          node.x(), node.y(), node.width() * scaleX, node.height() * scaleY,
                          zoom, stageSize.width, stageSize.height, pdfRotation
                        )
                        applyChange(prev => ({
                          fields: prev.fields.map(ff =>
                            ff.id === selectedId ? { ...ff, x: nx, y: ny, w: nw, h: nh } : ff
                          )
                        }))
                      }}
                    />
                  )
                })}
                {selectedId && (
                  <Transformer
                    ref={trRef}
                    rotateEnabled={false}
                    boundBoxFunc={(oldBox, newBox) => {
                      if (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10) return oldBox
                      return newBox
                    }}
                  />
                )}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>

      <aside className="panel-right">
        <button
          type="button"
          className="btn btn-primary"
          onClick={parseTextInFields}
          disabled={parsing || !pdf || pageFields.length === 0}
          title="Extract text from selection boxes"
          style={{ width: '100%' }}
        >
          {parsing ? 'Parsing…' : 'Parse text'}
        </button>

        <div className="section">
          <span className="section-label">Fields on this page</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pageFields.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`field-card ${f.id === selectedId ? 'active' : ''}`}
                style={{ borderLeftWidth: 4, borderLeftColor: strokeColorForType(f.type, f.id === selectedId) }}
              >
                <div className="field-card-name">{f.name}</div>
                <div className="field-card-meta">x={Math.round(f.x)} y={Math.round(f.y)} w={Math.round(f.w)} h={Math.round(f.h)}</div>
                {(() => {
                  const disp = fieldDisplayValue(f.value)
                  return disp ? (
                    <div className="field-card-value" title={disp}>
                      {disp.length > 30 ? `${disp.slice(0, 30)}…` : disp}
                    </div>
                  ) : null
                })()}
              </button>
            ))}
            {!pageFields.length && <div className="hint">No fields on this page</div>}
          </div>
        </div>

      </aside>
    </div>
  )
}
