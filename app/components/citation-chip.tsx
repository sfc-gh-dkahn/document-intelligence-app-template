"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { FileText } from "lucide-react"
import { encodeDocId, resolveDocId, filenameFromPath } from "@/lib/doc-utils"

interface CitationChipProps {
  filePath?: string
  fileId?: string
  filename?: string
  pageNumber?: number
  label: string
}

export function CitationChip({ filePath, fileId, filename, pageNumber, label }: CitationChipProps) {
  const router = useRouter()
  const [resolving, setResolving] = useState(false)

  const handleClick = useCallback(async () => {
    if (filePath) {
      const id = encodeDocId(filePath)
      const url = pageNumber ? `/documents/detail?id=${id}&page=${pageNumber}` : `/documents/detail?id=${id}`
      router.push(url)
      return
    }

    const query = fileId || filename
    if (!query) return

    setResolving(true)
    try {
      const fp = await resolveDocId(query)
      if (fp) {
        const id = encodeDocId(fp)
        const url = pageNumber ? `/documents/detail?id=${id}&page=${pageNumber}` : `/documents/detail?id=${id}`
        router.push(url)
      }
    } finally {
      setResolving(false)
    }
  }, [filePath, fileId, filename, pageNumber, router])

  return (
    <button
      onClick={handleClick}
      disabled={resolving}
      title={filePath ? filenameFromPath(filePath) : label}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md text-xs font-medium
                 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100
                 transition-colors cursor-pointer align-baseline leading-normal"
    >
      <FileText size={11} className="shrink-0" />
      <span className="truncate max-w-[200px]">{resolving ? "..." : label}</span>
    </button>
  )
}
