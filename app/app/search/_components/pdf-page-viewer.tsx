"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react"

interface PdfPageViewerProps {
  pdfData: ArrayBuffer
  pageNumber: number
  highlightTerms?: string[]
  onPageCount?: (count: number) => void
}

export function PdfPageViewer({ pdfData, pageNumber, highlightTerms, onPageCount }: PdfPageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const pdfDocRef = useRef<any>(null)
  const renderTaskRef = useRef<any>(null)

  // Load the PDF document once
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { getDocument } = await import("pdfjs-dist")
        const { configurePdfWorker } = await import("@/lib/pdf-worker")
        configurePdfWorker()

        const loadingTask = getDocument({ data: pdfData.slice(0) })
        const doc = await loadingTask.promise
        if (cancelled) return
        pdfDocRef.current = doc
        setTotalPages(doc.numPages)
        onPageCount?.(doc.numPages)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load PDF")
      }
    })()
    return () => { cancelled = true }
  }, [pdfData, onPageCount])

  // Render the specific page
  useEffect(() => {
    if (!pdfDocRef.current || pageNumber < 1 || pageNumber > totalPages) return
    let cancelled = false

    // Cancel any in-flight render to avoid "Cannot use the same canvas" error
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
      renderTaskRef.current = null
    }

    setRendering(true)
    setError(null)

    ;(async () => {
      try {
        const { TextLayer } = await import("pdfjs-dist")
        const doc = pdfDocRef.current
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const container = containerRef.current
        const canvas = canvasRef.current
        const textDiv = textLayerRef.current
        if (!canvas || !textDiv || !container) return

        // Calculate scale to fit container width
        const containerWidth = container.clientWidth || 800
        const unscaledViewport = page.getViewport({ scale: 1 })
        const scale = Math.min((containerWidth - 32) / unscaledViewport.width, 2.0)
        const viewport = page.getViewport({ scale })

        // Set canvas dimensions
        canvas.width = viewport.width * window.devicePixelRatio
        canvas.height = viewport.height * window.devicePixelRatio
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const ctx = canvas.getContext("2d")!
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

        // Render canvas
        const renderTask = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = renderTask
        await renderTask.promise
        renderTaskRef.current = null
        if (cancelled) return

        // Render text layer
        textDiv.innerHTML = ""
        // Set --total-scale-factor so pdf.js CSS calc() expressions resolve correctly.
        // Also set rounding vars to 1px so setLayerDimensions computes proper width/height.
        textDiv.style.setProperty("--total-scale-factor", `${scale}`)
        textDiv.style.setProperty("--scale-round-x", "1px")
        textDiv.style.setProperty("--scale-round-y", "1px")

        const textContent = await page.getTextContent()
        if (cancelled) return

        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport,
        })
        await textLayer.render()

        // Ensure dimensions match canvas exactly (in case setLayerDimensions rounding differs)
        textDiv.style.width = `${viewport.width}px`
        textDiv.style.height = `${viewport.height}px`
        if (cancelled) return

        // Highlight matching terms — delay to ensure browser has laid out text spans
        if (highlightTerms?.length) {
          requestAnimationFrame(() => {
            if (!cancelled) highlightMatches(textDiv, highlightTerms)
          })
        }

        setRendering(false)
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to render page"
          // Ignore cancellation errors from renderTask.cancel()
          if (!msg.includes("Rendering cancelled")) {
            setError(msg)
          }
          setRendering(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
    }
  }, [pdfDocRef.current, pageNumber, totalPages, highlightTerms])

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-500 dark:text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-auto flex justify-center bg-slate-100 dark:bg-slate-900">
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-slate-100/80 dark:bg-slate-900/80">
          <Loader2 size={24} className="animate-spin text-slate-400" />
        </div>
      )}
      <div className="relative my-4 shadow-lg">
        <canvas ref={canvasRef} className="block" />
        <div
          ref={textLayerRef}
          className="textLayer"
        />
      </div>
    </div>
  )
}

function highlightMatches(container: HTMLElement, terms: string[]) {
  if (!terms.length) return
  const words = terms.filter(t => t.length > 2)
  if (!words.length) return

  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const regex = new RegExp(pattern, "gi")

  // Simply add/remove a CSS class on matching spans.
  // The text layer spans are already perfectly positioned over the canvas —
  // adding a background to them creates a visible highlight at the correct location.
  const spans = container.querySelectorAll("span")
  spans.forEach(span => {
    const text = span.textContent ?? ""
    regex.lastIndex = 0
    if (text.trim() && regex.test(text)) {
      span.classList.add("search-match")
    } else {
      span.classList.remove("search-match")
    }
  })
}

interface PdfViewerWithNavProps {
  pdfData: ArrayBuffer
  initialPage?: number
  highlightTerms?: string[]
}

export function PdfViewerWithNav({ pdfData, initialPage = 1, highlightTerms }: PdfViewerWithNavProps) {
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [totalPages, setTotalPages] = useState(0)

  useEffect(() => {
    setCurrentPage(initialPage)
  }, [initialPage])

  const handlePageCount = useCallback((count: number) => {
    setTotalPages(count)
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Page navigation header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-500"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
            Page {currentPage}{totalPages > 0 ? ` of ${totalPages}` : ""}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-500"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        {highlightTerms && highlightTerms.length > 0 && (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            Highlighting: {highlightTerms.slice(0, 3).join(", ")}{highlightTerms.length > 3 ? "…" : ""}
          </span>
        )}
      </div>

      {/* PDF renderer */}
      <div className="flex-1 overflow-hidden">
        <PdfPageViewer
          pdfData={pdfData}
          pageNumber={currentPage}
          highlightTerms={highlightTerms}
          onPageCount={handlePageCount}
        />
      </div>
    </div>
  )
}
