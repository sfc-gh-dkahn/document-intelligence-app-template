import { redirect } from "next/navigation"

export default function ExtractionTestPage() {
  redirect("/admin/extraction-schema?tab=test")
}
