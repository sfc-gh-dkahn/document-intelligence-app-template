"use client"

import { useCallback, useState, useEffect } from "react"
import { FileDown, X, ExternalLink, Loader2 } from "lucide-react"

/**
 * Builds a proxy URL that serves the document through the app.
 */
function buildProxyUrl(filePath: string, stageName?: string | null): string {
  const params = new URLSearchParams({ file_path: filePath })
  if (stageName) params.set("stage_name", stageName)
  return `/api/documents/proxy?${params}`
}

/**
 * Document preview modal — fetches PDF via proxy and renders using iframe + blob URL.
 * 
 * In SPCS:
 * - iframe src="/api/proxy" fails (X-Frame-Options on HTTP responses)
 * - <object data="blob:..."> fails (CSP object-src blocks blob:)
 * - iframe src="blob:..." WORKS because blob URLs are synthetic same-origin
 *   documents with no HTTP headers (no X-Frame-Options, no CSP restrictions)
 * 
 * Flow: fetch proxy → get PDF bytes → create blob URL → render in iframe
 * Fallback: if proxy returns HTML (parsed text), render directly in a div.
 */
function DocPreviewModal({
  filePath,
  proxyUrl,
  downloadUrl,
  onClose,
}: {
  filePath: string
  proxyUrl: string
  downloadUrl: string
  onClose: () => void
}) {
  const fileName = filePath.split("/").pop() ?? filePath
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    let revoke: string | null = null
    ;(async () => {
      try {
        const res = await fetch(proxyUrl)
        if (!res.ok) {
          setFetchError(`Server returned ${res.status}`)
          setFetching(false)
          return
        }
        const ct = res.headers.get("content-type") ?? ""
        if (ct.includes("text/html")) {
          // Proxy fell back to parsed text — render as HTML
          const text = await res.text()
          setHtmlContent(text)
        } else {
          // Got binary (PDF/image) — create blob URL for iframe rendering
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          revoke = url
          setBlobUrl(url)
        }
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : "Failed to load")
      }
      setFetching(false)
    })()
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [proxyUrl])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            <FileDown size={18} className="text-slate-500 shrink-0" />
            <span className="font-mono text-sm text-slate-700 truncate">{fileName}</span>
            <span className="text-xs text-slate-400 shrink-0">{ext.toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={downloadUrl}
              download={fileName}
              className="sf-btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5"
            >
              <FileDown size={13} /> Download
            </a>
            <a
              href={proxyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5"
            >
              <ExternalLink size={13} /> Open in New Tab
            </a>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-200 text-slate-500">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-slate-100">
          {fetching ? (
            <div className="flex items-center justify-center h-full gap-2 text-slate-500">
              <Loader2 size={20} className="animate-spin" /> Loading document...
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
              <FileDown size={48} className="text-slate-300" />
              <p className="text-sm">Could not load document preview</p>
              <p className="text-xs text-slate-400">{fetchError}</p>
              <a href={downloadUrl} download={fileName} className="sf-btn-primary py-1.5 px-3 text-xs">
                Download Original
              </a>
            </div>
          ) : blobUrl ? (
            // PDF/image via blob URL in iframe — bypasses X-Frame-Options since
            // blob: is a synthetic same-origin URL with no HTTP response headers
            <iframe
              src={blobUrl}
              className="w-full h-full border-0"
              title={`Preview: ${fileName}`}
            />
          ) : htmlContent ? (
            // Parsed text HTML fallback (when presigned URL fails server-side)
            <iframe
              sandbox=""
              srcDoc={htmlContent}
              className="w-full h-full bg-white border-0"
              title="Document preview"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Hook + state for document preview modal.
 * Uses the proxy URL for inline display (same-origin, no S3 IAM issues).
 * Falls back to presigned URL for download/new-tab when available.
 */
export function useDocumentPreview() {
  const [modal, setModal] = useState<{ filePath: string; proxyUrl: string } | null>(null)

  const open = useCallback((filePath: string, stageName?: string | null) => {
    const proxyUrl = buildProxyUrl(filePath, stageName)
    setModal({ filePath, proxyUrl })
  }, [])

  const close = useCallback(() => setModal(null), [])

  const ModalComponent = modal ? (
    <DocPreviewModal filePath={modal.filePath} proxyUrl={modal.proxyUrl} downloadUrl={modal.proxyUrl} onClose={close} />
  ) : null

  return { open, loading: false, ModalComponent }
}

/**
 * Inline download button — small icon that opens the preview modal.
 */
export function DocDownloadBtn({
  filePath,
  stageName,
  className = "",
  onOpen,
}: {
  filePath: string
  stageName?: string | null
  className?: string
  onOpen: (filePath: string, stageName?: string | null) => void
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(filePath, stageName) }}
      className={`inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline ${className}`}
      title="View document"
    >
      <FileDown size={12} />
    </button>
  )
}

/**
 * Clickable file path text — renders the path as a link that opens the preview modal.
 */
export function DocFileLink({
  filePath,
  stageName,
  displayName,
  className = "",
  onOpen,
}: {
  filePath: string
  stageName?: string | null
  displayName?: string
  className?: string
  onOpen: (filePath: string, stageName?: string | null) => void
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(filePath, stageName) }}
      className={`text-left font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer ${className}`}
      title={`View: ${filePath}`}
    >
      {displayName ?? filePath}
    </button>
  )
}

/**
 * Standalone loading indicator for when a document is being fetched.
 */
export function DocLoadingIndicator({ loading }: { loading: boolean }) {
  if (!loading) return null
  return (
    <div className="fixed bottom-4 right-4 z-40 bg-white shadow-lg rounded-lg px-4 py-2 flex items-center gap-2 text-sm text-slate-600 border border-slate-200">
      <Loader2 size={14} className="animate-spin" /> Loading document...
    </div>
  )
}
