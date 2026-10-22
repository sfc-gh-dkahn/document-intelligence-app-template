"use client"

import { useState, useEffect } from "react"
import { Loader2, AlertCircle, ExternalLink, FileDown } from "lucide-react"
import { PdfViewerWithNav } from "./pdf-page-viewer"

interface InlineDocViewerProps {
  filePath: string
  page?: number | null
  highlightTerms?: string[]
}

export function InlineDocViewer({ filePath, page, highlightTerms }: InlineDocViewerProps) {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const proxyUrl = `/api/documents/proxy?file_path=${encodeURIComponent(filePath)}`

  useEffect(() => {
    setLoading(true)
    setError(null)
    setPdfData(null)
    setHtmlContent(null)
    ;(async () => {
      try {
        const res = await fetch(proxyUrl)
        if (!res.ok) { setError(`Server returned ${res.status}`); setLoading(false); return }
        const ct = res.headers.get("content-type") ?? ""
        setContentType(ct)
        if (ct.includes("text/html")) {
          const text = await res.text()
          setHtmlContent(text)
        } else if (ct.includes("pdf")) {
          const buffer = await res.arrayBuffer()
          setPdfData(buffer)
        } else {
          // Non-PDF binary (image, etc) — fall back to blob URL in iframe
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          setHtmlContent(null)
          setPdfData(null)
          // Store as special marker for iframe fallback
          setContentType(`blob:${url}`)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load")
      }
      setLoading(false)
    })()
  }, [proxyUrl])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-slate-500 dark:text-slate-400">
        <Loader2 size={20} className="animate-spin" /> Loading document...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500 dark:text-slate-400">
        <AlertCircle size={32} className="text-slate-300" />
        <p className="text-sm">Could not load preview</p>
        <p className="text-xs text-slate-400">{error}</p>
        <a href={proxyUrl} target="_blank" rel="noopener noreferrer" className="sf-btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
          <ExternalLink size={12} /> Open in New Tab
        </a>
      </div>
    )
  }

  // PDF — use pdf.js renderer with highlighting
  if (pdfData) {
    return (
      <PdfViewerWithNav
        pdfData={pdfData}
        initialPage={page != null ? page + 1 : 1}
        highlightTerms={highlightTerms}
      />
    )
  }

  // HTML fallback (parsed text)
  if (htmlContent) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 shrink-0">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
            {filePath.split("/").pop()}
          </span>
          <a href={proxyUrl} download className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400" title="Download">
            <FileDown size={12} />
          </a>
        </div>
        <iframe
          sandbox=""
          srcDoc={htmlContent}
          className="flex-1 w-full bg-white border-0"
          title="Document preview"
        />
      </div>
    )
  }

  // Blob URL fallback (images, TIFF, etc)
  if (contentType.startsWith("blob:")) {
    const blobUrl = contentType.slice(5)
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 shrink-0">
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
            {filePath.split("/").pop()}
          </span>
          <a href={proxyUrl} download className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400" title="Download">
            <FileDown size={12} />
          </a>
        </div>
        <iframe
          src={blobUrl}
          className="flex-1 w-full border-0"
          title="Document preview"
        />
      </div>
    )
  }

  return null
}
