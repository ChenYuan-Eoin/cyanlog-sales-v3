'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'

interface TenderParseResult {
  id: string
  tender_id: string
  status: 'PENDING' | 'PARSING' | 'COMPLETED' | 'FAILED'
  extracted_data: Record<string, string>
  raw_text: string
  confidence: number
  error: string
  started_at: string
  completed_at: string
  created_at: string
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待解析', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  COMPLETED: { label: '已完成', variant: 'outline' },
  FAILED: { label: '失败', variant: 'destructive' },
}

export default function TenderOCRPage() {
  const params = useParams()
  const [result, setResult] = useState<TenderParseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  const tenderId = params.id as string

  useEffect(() => {
    fetchParseResult()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId])
    const subscription = supabase
      .channel(`tender_${tenderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tender_parse_results',
          filter: `tender_id=eq.${tenderId}`,
        },
        (payload) => {
          console.log('Realtime update:', payload)
          setResult(payload.new as TenderParseResult)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [tenderId])

  async function fetchParseResult() {
    try {
      const { data, error } = await supabase
        .from('tender_parse_results')
        .select('*')
        .eq('tender_id', tenderId)
        .single()

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        console.error('Fetch error:', error)
      }

      if (data) {
        setResult(data)
      }
    } catch {
      // Ignore errors
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')

    try {
      // 1. Upload file to Storage
      const fileExt = file.name.split('.').pop()
      const fileName = `${tenderId}/${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('tenders')
        .upload(fileName, file)

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`)
      }

      // 2. Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('tenders')
        .getPublicUrl(fileName)

      // 3. Create parse result record
      const { error: insertError } = await supabase
        .from('tender_parse_results')
        .insert({
          tender_id: tenderId,
          status: 'PENDING',
        })

      if (insertError) {
        throw new Error(`Failed to create parse record: ${insertError.message}`)
      }

      // 4. Trigger OCR Edge Function
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
            fileUrl: publicUrl,
            tenderId,
            userId: session?.user?.id,
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'OCR processing failed')
      }

      // Refetch result
      fetchParseResult()

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return <div className="p-8">加载中...</div>
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">招标文件 OCR 解析</h1>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileUpload}
          disabled={uploading}
          className="hidden"
          id="tender-upload"
        />
        <label htmlFor="tender-upload">
          <Button asChild disabled={uploading}>
            <span>{uploading ? '上传中...' : '上传招标文件'}</span>
          </Button>
        </label>
      </div>

      {error && (
        <div className="p-4 mb-6 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      {!result ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500">暂无解析结果，请上传招标文件</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>解析状态</span>
                <Badge variant={statusMap[result.status]?.variant || 'default'}>
                  {statusMap[result.status]?.label || result.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.status === 'PARSING' && (
                <div className="py-4 text-center">
                  <div className="animate-pulse">
                    <p className="text-slate-500">OCR 解析进行中...</p>
                  </div>
                </div>
              )}

              {result.status === 'COMPLETED' && (
                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">置信度</span>
                    <span>{(result.confidence * 100).toFixed(1)}%</span>
                  </div>

                  {Object.keys(result.extracted_data).length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(result.extracted_data).map(([key, value]) => (
                            <tr key={key} className="border-b last:border-0">
                              <td className="p-3 bg-slate-50 font-medium w-1/3">
                                {getFieldLabel(key)}
                              </td>
                              <td className="p-3">{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {result.raw_text && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">原始文本</h4>
                      <pre className="p-3 bg-slate-50 rounded-lg text-xs overflow-auto max-h-60">
                        {result.raw_text}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {result.status === 'FAILED' && (
                <div className="p-4 text-red-600 bg-red-50 rounded-lg">
                  <p className="font-medium">解析失败</p>
                  <p className="text-sm mt-1">{result.error || 'Unknown error'}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function getFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    tenderNo: '招标编号',
    deadline: '投标截止日期',
    amount: '金额要求',
    projectName: '项目名称',
    biddingUnit: '招标单位',
    contact: '联系人',
    phone: '电话',
  }
  return labels[key] || key
}
