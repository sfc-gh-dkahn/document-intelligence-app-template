"use client"

import { HelpCircle, Search, MessageSquare, FileText, Shield, Settings, BarChart3, Bookmark } from "lucide-react"
import { PageHeader } from "@/components/page-header"

const sections = [
  {
    title: "Getting Started",
    icon: HelpCircle,
    content: [
      "Document Intelligence uses Snowflake Cortex AI to parse, classify, and extract key fields from your documents.",
      "Your app roles decide which lines of business and document types you see.",
      "Use the sidebar to move between pages. The Overview page summarizes the documents you can see.",
    ],
  },
  {
    title: "Document Search",
    icon: Search,
    content: [
      "Document Search uses Cortex Search to find documents by meaning and by keyword.",
      "Type what you're looking for, for example \"Documents mentioning renewal\".",
      "Results include only documents your app roles allow.",
      "Click any result to open its detail page.",
    ],
  },
  {
    title: "Doc Intelligence (Chat)",
    icon: MessageSquare,
    content: [
      "Doc Intelligence uses a Cortex Agent to answer questions about your documents.",
      "Ask questions like \"What is the effective date on document XYZ?\" or \"Compare these two documents.\"",
      "Citations appear as chips in the response. Click one to open that document's detail page.",
      "Use thumbs up/down to give feedback on an answer.",
    ],
  },
  {
    title: "Document Browser",
    icon: FileText,
    content: [
      "Browse the documents you can see in a filterable table.",
      "Filter by document type, line of business, or status.",
      "Click any document to open its detail page, with Document, History, Related, and Raw Text tabs.",
      "On the detail page, click the pencil icon next to a field to submit a correction. An admin approves it in Quality & Feedback.",
    ],
  },
  {
    title: "Review Queue",
    icon: Shield,
    content: [
      "The Review Queue shows documents the AI matched to three or more document types.",
      "Approve confirms the document type. Skip removes the document from your queue without approving it.",
      "Correct lets you pick a different document type. The correction waits for admin approval.",
    ],
  },
  {
    title: "Overview Analytics",
    icon: BarChart3,
    content: [
      "The Overview page shows charts of your documents by type, line of business, and status.",
      "Ask a Question sends your question to the Doc Intelligence agent, for example \"How many documents were processed by month this year?\"",
    ],
  },
  {
    title: "Saved Items",
    icon: Bookmark,
    content: [
      "See your saved searches and bookmarked documents in one place.",
      "Saved searches keep your query and filters. Click one to run it again.",
      "Bookmark documents from Document Search results or a document's detail page.",
      "Delete a saved item with its trash icon.",
    ],
  },
  {
    title: "Administration",
    icon: Settings,
    content: [
      "Admin pages need the DOC_INTEL_ADMIN Snowflake role as well as an app role that includes them.",
      "Pipeline Management: upload files, run the pipeline, and reprocess documents.",
      "Ingestion Registry: the status of every file.",
      "Quality & Feedback: approve or reject corrections.",
      "Extraction Schema, Classification Labels, Lines of Business, Suggested Searches: configure the AI.",
      "Audit Log: document events, filterable by date range, event type, and user.",
      "User Management: assign app roles. A user can hold several and gets their combined access.",
    ],
  },
]

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Help & Documentation" icon={HelpCircle} />

      {sections.map(({ title, icon: Icon, content }) => (
        <div key={title} className="sf-card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Icon size={14} style={{ color: "var(--brand-primary)" }} />
            <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          </div>
          <div className="p-5 space-y-2">
            {content.map((para, i) => (
              <p key={i} className="text-sm text-slate-600 leading-relaxed">{para}</p>
            ))}
          </div>
        </div>
      ))}

      <div className="sf-card p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Tips</h3>
        <div className="space-y-1.5 text-xs text-slate-600">
          <p>Use the search page for quick keyword lookups across all your accessible documents.</p>
          <p>The chat feature supports follow-up questions — ask clarifying questions about previous answers.</p>
          <p>Click any citation chip in chat responses to open the full document detail page with extracted attributes, history, and raw text.</p>
          <p>On the Document Browser, use the checkbox column to select multiple documents for batch actions.</p>
        </div>
      </div>
    </div>
  )
}
