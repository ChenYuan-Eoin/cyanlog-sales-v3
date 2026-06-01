// Supabase Edge Function: OCR Processor
// F008 - OCR 招标文件解析（使用 contracts 表，无需新迁移）

import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.39.0'

interface OCRRequest {
  contractId: string
  fileUrl: string
  userId: string
}

interface OCResult {
  text: string
  confidence: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { contractId, fileUrl } = await req.json() as OCRRequest

    if (!contractId || !fileUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing contractId or fileUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Update ocr_status to PARSING
    await supabase
      .from('contracts')
      .update({ ocr_status: 'PARSING' })
      .eq('id', contractId)

    // Call OCR (mock or cloud)
    const ocrResult = await callOCR(fileUrl)
    const extractedData = extractTenderData(ocrResult.text)

    // Update contracts table directly
    const { error } = await supabase
      .from('contracts')
      .update({
        ocr_status: 'COMPLETED',
        ocr_result: {
          extracted_data: extractedData,
          raw_text: ocrResult.text,
          confidence: ocrResult.confidence,
          completed_at: new Date().toISOString(),
        },
      })
      .eq('id', contractId)

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, contractId, extractedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[OCR] Error:', error)

    // Update status to FAILED
    try {
      const body = await req.clone().json() as OCRRequest
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        await supabase
          .from('contracts')
          .update({ ocr_status: 'FAILED' })
          .eq('id', body.contractId)
      }
    } catch { /* ignore */ }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'OCR failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function callOCR(fileUrl: string): Promise<OCResult> {
  // Mock OCR - replace with cloud OCR in production
  await new Promise(r => setTimeout(r, 1500))
  return {
    text: `招标编号：2024-001
项目名称：示例招标项目
投标截止日期：2024-12-31
金额要求：500万元`,
    confidence: 0.95,
  }
}

function extractTenderData(text: string) {
  const patterns: Record<string, RegExp> = {
    tenderNo: /招标编号[：:]\s*(.+?)(?:\n|$)/i,
    deadline: /投标截止日期[：:]\s*(.+?)(?:\n|$)/i,
    amount: /金额要求[：:]\s*(.+?)(?:\n|$)/i,
    projectName: /项目名称[：:]\s*(.+?)(?:\n|$)/i,
  }
  const result: Record<string, string> = {}
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern)
    if (match) result[key] = match[1].trim()
  }
  return result
}
