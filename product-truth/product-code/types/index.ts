export interface User {
  id: string
  email: string | null
  phone: string | null
  display_name: string | null
  avatar_url: string | null
  status: 'active' | 'inactive' | 'suspended'
  created_at: string
  updated_at: string
}

export interface Quote {
  id: string
  quote_no: string
  customer_name: string
  customer_contact: string | null
  subtotal: number
  tax_amount: number
  discount_amount: number
  total_amount: number
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED'
  valid_until: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface QuoteItem {
  id: string
  quote_id: string
  product_type: string
  name: string
  quantity: number
  unit_price: number
  discount: number
  line_total: number
  sort_order: number
}

export interface Contract {
  id: string
  filename: string
  storage_path: string
  size: number
  mime_type: string
  status: 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED'
  parsed_text: string | null
  ocr_status?: 'PENDING' | 'PARSING' | 'COMPLETED' | 'FAILED'
  ocr_result?: {
    extracted_data: Record<string, string>
    raw_text: string
    confidence: number
    completed_at: string
  }
  created_by: string | null
  created_at: string
  updated_at: string
  contract_reviews?: ContractReview[]
  contract_analysis_jobs?: ContractAnalysisJob[]
  latest_analysis_job?: ContractAnalysisJob | null
}

export interface ContractReview {
  id: string
  contract_id: string
  status: 'PENDING' | 'PARSING' | 'ANALYZING' | 'COMPLETED' | 'FAILED'
  results: {
    risks: Risk[]
    summary: string
    appliedRules: number
    matchedRules: number
  }
  ai_result: unknown
  rule_version: number | null
  created_at: string
  completed_at: string | null
}

export interface ContractAnalysisJob {
  id: string
  contract_id: string
  review_id: string
  requested_by: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  attempts: number
  provider: string | null
  degraded: boolean
  last_error: string | null
  locked_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Risk {
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
}

export interface ApiResponse<T> {
  data?: T
  error?: string
  meta?: {
    page: number
    pageSize: number
    total: number
  }
}
