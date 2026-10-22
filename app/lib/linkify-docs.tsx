"use client"

import React from "react"
import { CitationChip } from "@/components/citation-chip"
import type { Components } from "react-markdown"

const COMBINED_RE = new RegExp(
  `(\\[[^\\]]+\\.(?:pdf|docx|tiff?|png|jpg|jpeg),\\s*p\\.\\d+\\])` +
  `|((?:documents\\/)?[\\w\\-\\/]+\\.(?:pdf|docx|tiff?|png|jpg|jpeg))\\b` +
  `|(\\((?:File|Source|Ref|Case)[:\\s#]*[A-Z]{2,4}[\\-\\s]?\\d{4}[\\-\\s]?\\d{3,5}\\))`,
  "gi"
)

export function linkifyDocRefs(children: React.ReactNode): React.ReactNode {
  if (!children) return children
  if (typeof children === "string") {
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    COMBINED_RE.lastIndex = 0
    while ((match = COMBINED_RE.exec(children)) !== null) {
      if (match.index > lastIndex) parts.push(children.slice(lastIndex, match.index))
      if (match[1]) {
        const inner = match[1].slice(1, -1)
        const commaIdx = inner.lastIndexOf(",")
        const fn = inner.slice(0, commaIdx).trim()
        const pg = parseInt(inner.slice(commaIdx + 1).replace(/\D/g, ""), 10) || undefined
        parts.push(<CitationChip key={`c-${match.index}`} filename={fn} pageNumber={pg} label={`${fn}${pg ? `, p.${pg}` : ""}`} />)
      } else if (match[2]) {
        const fp = match[2]
        const fn = fp.split("/").pop() ?? fp
        parts.push(<CitationChip key={`f-${match.index}`} filePath={fp.includes("/") ? fp : undefined} filename={fp.includes("/") ? undefined : fp} label={fn} />)
      } else if (match[3]) {
        const idMatch = match[3].match(/([A-Z]{2,4}[\-\s]?\d{4}[\-\s]?\d{3,5})/i)
        if (idMatch) {
          parts.push(<CitationChip key={`id-${match.index}`} fileId={idMatch[1]} label={idMatch[1]} />)
        } else {
          parts.push(match[3])
        }
      }
      lastIndex = match.index + match[0].length
    }
    if (parts.length === 0) return children
    if (lastIndex < children.length) parts.push(children.slice(lastIndex))
    return parts
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => <React.Fragment key={i}>{linkifyDocRefs(child)}</React.Fragment>)
  }
  return children
}

export const docRefMdComponents: Components = {
  p: ({ children, ...props }) => <p {...props}>{linkifyDocRefs(children)}</p>,
  li: ({ children, ...props }) => <li {...props}>{linkifyDocRefs(children)}</li>,
  strong: ({ children, ...props }) => <strong {...props}>{linkifyDocRefs(children)}</strong>,
  td: ({ children, ...props }) => <td className="border border-slate-300 px-3 py-1.5" {...props}>{linkifyDocRefs(children)}</td>,
  table: ({ children, ...props }) => <table className="border-collapse border border-slate-300 my-2 text-sm w-full" {...props}>{children}</table>,
  th: ({ children, ...props }) => <th className="border border-slate-300 px-3 py-1.5 bg-slate-100 font-semibold text-left" {...props}>{children}</th>,
}
