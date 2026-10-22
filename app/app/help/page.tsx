"use client"

import { HelpCircle, Search, MessageSquare, FileText, Shield, Settings, BarChart3, Bookmark } from "lucide-react"
import { PageHeader } from "@/components/page-header"

const sections = [
  {
    title: "Getting Started",
    icon: HelpCircle,
    content: [
      "Document Intelligence uses Snowflake Cortex AI to read your documents. It automatically parses, classifies, and extracts key data from your document corpus.",
      "Your access is determined by your assigned roles. Each role grants access to specific Lines of Business (LOBs) and document types.",
      "Use the sidebar to navigate between features. The Dashboard shows a summary of your accessible documents and recent activity.",
    ],
  },
  {
    title: "Document Search",
    icon: Search,
    content: [
      "The Document Search page uses Cortex Search for intelligent document discovery.",
      "Type natural language questions like \"Find all contracts from 2024\" or \"Documents mentioning renewal\".",
      "Results are scoped to documents you have access to based on your entitlement roles.",
      "Click any result to view the full document detail page with extracted attributes.",
    ],
  },
  {
    title: "Ask a Question (Chat)",
    icon: MessageSquare,
    content: [
      "The Chat feature uses a Cortex Agent to answer questions about your documents.",
      "Ask questions like \"What is the effective date on document XYZ?\" or \"Compare these two documents.\"",
      "Citations appear as clickable blue chips in the response. Filenames and file IDs are detected automatically and link to the document detail page.",
      "Use thumbs up/down to provide feedback on answer quality.",
    ],
  },
  {
    title: "Document Browser",
    icon: FileText,
    content: [
      "Browse all documents you have access to in a searchable, filterable table.",
      "Filter by document type, line of business, or status.",
      "Click any document to view its detail page with 4 tabs: Attributes, History, Related Documents, and Raw Text.",
      "On the Attributes tab, click the pencil icon to make inline corrections to extracted fields.",
    ],
  },
  {
    title: "Review Queue",
    icon: Shield,
    content: [
      "The Review Queue shows documents flagged for human review (low extraction confidence).",
      "Documents are filtered by your LOB entitlements — you only see documents in your areas.",
      "Approve: Confirms the extraction is correct. Skip: Removes from your queue without approval.",
      "Use Correct to fix individual extracted fields and submit corrections.",
    ],
  },
  {
    title: "Portfolio Analytics",
    icon: BarChart3,
    content: [
      "View charts and KPIs showing document distribution by type, line of business, and status.",
      "Use the natural language query box to ask analytics questions — e.g., \"Show document volume by type over the last 6 months.\"",
      "Queries are powered by Cortex Analyst (Semantic View) and return data tables or visualizations.",
      "Data shown is scoped to your assigned lines of business and document types.",
    ],
  },
  {
    title: "Saved Items",
    icon: Bookmark,
    content: [
      "View your saved searches and bookmarked documents in one place.",
      "Saved searches preserve your query and filters — click to re-run them instantly.",
      "Bookmarks are set from the Document Browser or Search results using the bookmark icon.",
      "Delete saved items by clicking the trash icon on any entry.",
    ],
  },
  {
    title: "Administration",
    icon: Settings,
    content: [
      "Admin users have access to Pipeline Health, Extraction Schema, Quality & Feedback, Audit Log, and User Management.",
      "Pipeline Health: Monitor ingestion, parsing, classification, and extraction stages.",
      "Extraction Schema: Define and manage the fields extracted for each document type.",
      "Quality & Feedback: Review correction rates by field and LOB, approve/reject pending corrections.",
      "Audit Log: View download/view events with date range and user filters.",
      "User Management: Assign roles to users. Users can have multiple roles (union semantics).",
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
