// Supabase Edge Function: OCR Processor
// F008 - OCR 招标文件解析

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'npm:@supabase/supabase-js@2.39.0'

interface OCRRequest {
  fileUrl: string
  tenderId: string
  userId: string
}

interface OCResult {
  text: string
  confidence: number
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { fileUrl, tenderId, userId } = await req.json() as OCRRequest

    if (!fileUrl || !tenderId) {
      return new Response(
        JSON.stringify({ error: 'Missing fileUrl or tenderId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Update status to PARSING
    await supabase
      .from('tender_parse_results')
      .update({ status: 'PARSING', started_at: new Date().toISOString() })
      .eq('tender_id', tenderId)

    console.log(`[OCR] Starting OCR for tender ${tenderId}, file: ${fileUrl}`)

    // Call cloud OCR API
    // In production, replace with your preferred OCR service
    const ocrResult = await callCloudOCR(fileUrl)

    console.log(`[OCR] Received ${ocrResult.text.length} chars with confidence ${ocrResult.confidence}`)

    // Extract structured data from OCR text
    const extractedData = extractTenderData(ocrResult.text)

    // Update database with results
    const { error } = await supabase
      .from('tender_parse_results')
      .update({
        status: 'COMPLETED',
        extracted_data: extractedData,
        raw_text: ocrResult.text,
        confidence: ocrResult.confidence,
        completed_at: new Date().toISOString(),
      })
      .eq('tender_id', tenderId)

    if (error) {
      console.error('[OCR] Database update error:', error)
      throw error
    }

    console.log(`[OCR] Completed for tender ${tenderId}`)

    return new Response(
      JSON.stringify({
        success: true,
        tenderId,
        extractedData,
        confidence: ocrResult.confidence,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[OCR] Error:', error)

    // Try to update status to FAILED
    try {
      const body = await req.clone().json() as OCRRequest
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        await supabase
          .from('tender_parse_results')
          .update({
            status: 'FAILED',
            error: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('tender_id', body.tenderId)
      }
    } catch {
      // Ignore cleanup errors
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'OCR processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Call cloud OCR API
 * Replace with your preferred OCR service (Google Vision, Azure, AWS Textract, etc.)
 */
async function callCloudOCR(fileUrl: string): Promise<OCResult> {
  // Option 1: Google Vision API
  // const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY')
  // if (apiKey) {
  //   return callGoogleVision(fileUrl, apiKey)
  // }

  // Option 2: Azure Computer Vision
  // const azureKey = Deno.env.get('AZURE_VISION_KEY')
  // const azureEndpoint = Deno.env.get('AZURE_VISION_ENDPOINT')
  // if (azureKey && azureEndpoint) {
  //   return callAzureVision(fileUrl, azureKey, azureEndpoint)
  // }

  // Option 3: Mock for testing (remove in production)
  console.log(`[OCR] Using mock OCR for: ${fileUrl}`)
  await new Promise(resolve => setTimeout(resolve, 2000))

  return {
    text: `招标编号：2024-001
项目名称：示例招标项目
投标截止日期：2024-12-31
金额要求：500万元
招标单位：某某公司
联系人：张三
电话：13800138000`,
    confidence: 0.95,
  }
}

/**
 * Google Vision OCR (example implementation)
 */
async function callGoogleVision(fileUrl: string, apiKey: string): Promise<OCResult> {
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: fileUrl } },
          features: [{ type: 'TEXT_DETECTION' }],
        }],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Google Vision API failed: ${response.statusText}`)
  }

  const data = await response.json()
  const text = data.responses?.[0]?.fullTextAnnotation?.text || ''
  const confidence = data.responses?.[0]?.textAnnotations?.[0]?.confidence || 0.9

  return { text, confidence }
}

// Extract structured data from OCR text
function extractTenderData(text: string) {
  const patterns: Record<string, RegExp> = {
    tenderNo: /招标编号[：:]\s*(.+?)(?:\n|$)/i,
    deadline: /投标截止日期[：:]\s*(.+?)(?:\n|$)/i,
    amount: /金额要求[：:]\s*(.+?)(?:\n|$)/i,
    projectName: /项目名称[：:]\s*(.+?)(?:\n|$)/i,
    biddingUnit: /招标单位[：:]\s*(.+?)(?:\n|$)/i,
    contact: /联系人[：:]\s*(.+?)(?:\n|$)/i,
    phone: /电话[：:]\s*(.+?)(?:\n|$)/i,
  }

  const result: Record<string, string> = {}

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern)
    if (match) {
      result[key] = match[1].trim()
    }
  }

  return result
}

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ocr-processor' \
    --header 'Authorization: Bearer YOUR_ANON_TOKEN' \
    --header 'Content-Type: application/json' \
    --data '{"fileUrl":"https://...", "tenderId":"...", "userId":"..."}'

*/
