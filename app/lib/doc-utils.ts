/**
 * Shared document ID encoding and resolution utilities.
 * Used by detail pages, search, review, saved items, and citation chips.
 */

/** Base64url-encode a file_path for use in /documents/detail?id=... URLs. */
export function encodeDocId(filePath: string): string {
  return btoa(filePath).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Build a full URL to the document detail page. */
export function docDetailUrl(filePath: string, from?: string): string {
  const id = encodeDocId(filePath)
  return from ? `/documents/detail?id=${id}&from=${from}` : `/documents/detail?id=${id}`
}

/** Extract the filename from a full file_path. */
export function filenameFromPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath
}

const resolveCache = new Map<string, string | null>()

/** Resolve a document identifier (filename, file ID, etc.) to a file_path via search. */
export async function resolveDocId(id: string): Promise<string | null> {
  if (resolveCache.has(id)) return resolveCache.get(id)!
  try {
    const res = await fetch(`/api/documents?search=${encodeURIComponent(id)}&limit=1`)
    if (!res.ok) return null
    const data = await res.json()
    const docs = data.documents ?? data ?? []
    const fp = docs[0]?.FILE_PATH ?? docs[0]?.file_path ?? null
    resolveCache.set(id, fp)
    return fp
  } catch {
    return null
  }
}
