import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { generateDraftDocx } from '@/lib/export/draft-docx'

const draftExportSchema = z.object({
  title: z.string().trim().min(1, '合同标题必填').max(200),
  content: z.string().trim().min(1, '合同正文必填'),
})

function safeFilename(value: string) {
  const normalized = value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 80) || 'contract-draft'
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req)
    const parsed = draftExportSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || '导出参数无效' }, { status: 400 })
    }

    const buffer = await generateDraftDocx(parsed.data)
    const filename = `${safeFilename(parsed.data.title)}-草稿.docx`
    const encodedFilename = encodeURIComponent(filename)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '导出合同草稿失败',
    }, { status: 500 })
  }
}
