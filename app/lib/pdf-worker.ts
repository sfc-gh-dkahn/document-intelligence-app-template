import { GlobalWorkerOptions } from "pdfjs-dist"

let configured = false

export function configurePdfWorker() {
  if (configured) return
  GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
  configured = true
}
