'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'

interface OCRResult {
  extracted_data: Record<string, string>
  raw_text: string
  confidence: number
  completed_at: string
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待解析', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  COMPLETED: { label: '已完成', variant: 'outline' },
  FAILED: { label: '失败', variant: 'destructive' },
}

export default function ContractOCRPage() {
  const params = useParams()
  const [ocrStatus, setOcrStatus] = useState<string>('PENDING')
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const contractId = params.id as string

  useEffect(() => {
    fetchContract()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId])

  useEffect(() => {
    const subscription = supabase
      .channel(`contract_${contractId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'contracts',
        filter: `id=eq.${contractId}`,
      }, (payload) => {
        setOcrStatus(payload.new.ocr_status)
        setOcrResult(payload.new.ocr_result)
      })
      .subscribe()
    return () => { supabase.removeChannel(subscription) }
  }, [contractId])

  async function fetchContract() {
    const { data } = await supabase
      .from('contracts')
      .select('ocr_status, ocr_result')
      .eq('id', contractId)
      .single()
    if (data) {
      setOcrStatus(data.ocr_status || 'PENDING')
      setOcrResult(data.ocr_result)
    }
  }

  async function triggerOCR() {
    setUploading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ocr-processor`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contractId,
            fileUrl: 'placeholder', // 实际应从 Storage 获取
          }),
        }
      )
      if (!response.ok) throw new Error('OCR failed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">合同 OCR 解析</h1>
        <Button onClick={triggerOCR} disabled={uploading || ocrStatus === 'PARSING'}>
          {uploading ? '处理中...' : '重新解析'}
        </Button>
      </div>

      {error && <div className="p-4 mb-6 text-red-600 bg-red-50 rounded-lg">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>解析状态</span>
            <Badge variant={statusMap[ocrStatus]?.variant || 'default'}>
              {statusMap[ocrStatus]?.label || ocrStatus}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ocrStatus === 'PARSING' && (
            <div className="py-4 text-center animate-pulse">
              <p className="text-slate-500">OCR 解析进行中...</p>
            </div>
          )}

          {ocrResult && ocrStatus === 'COMPLETED' && (
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">置信度</span>
                <span>{(ocrResult.confidence * 100).toFixed(1)}%</span>
              </div>
              {Object.keys(ocrResult.extracted_data).length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(ocrResult.extracted_data).map(([key, value]) => (
                        <tr key={key} className="border-b last:border-0">
                          <td className="p-3 bg-slate-50 font-medium w-1/3">{key}</td>
                          <td className="p-3">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ocrResult.raw_text && (
                <pre className="p-3 bg-slate-50 rounded-lg text-xs overflow-auto max-h-60">
                  {ocrResult.raw_text}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
