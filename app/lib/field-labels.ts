/**
 * On-screen names for the extracted fields. Change a label here and every
 * screen (Document Browser, Search, Detail, Review, Saved) picks it up.
 *
 * The database column names stay the same (party_name, reference_number, ...).
 * The AI prompt for each field lives in sql/03_processing.sql
 * (sp_extract_document_attributes) — keep the two in step.
 */
export const FIELD_LABELS = {
  party_name:        "Party",
  issuer_name:       "Issuer",
  counterparty_name: "Counterparty",
  reference_number:  "Reference #",
  case_number:       "Case #",
  doc_subtype:       "Subtype",
  document_date:     "Document Date",
  reference_date:    "Other Key Date",
  start_date:        "Start Date",
  end_date:          "End Date",
  event_date:        "Event Date",
  primary_amount:    "Amount",
  total_amount:      "Total Amount",
  secondary_amount:  "Other Amount",
  key_terms:         "Key Terms",
  action_required:   "Action Required",
  doc_status:        "Status",
  doc_summary:       "Summary",
  document_type:     "Document Type",
  line_of_business:  "Line of Business",
  src_file_id:       "Source File ID",
} as const

export type FieldKey = keyof typeof FIELD_LABELS

/** Label for a field, accepting either column case (PARTY_NAME or party_name). */
export function fieldLabel(key: string): string {
  return FIELD_LABELS[key.toLowerCase() as FieldKey] ?? key
}
