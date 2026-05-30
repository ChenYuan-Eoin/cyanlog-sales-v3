import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

// GET /api/contracts - 获取合同列表
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    let query = supabase
      .from('contracts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query.range(
      (page - 1) * pageSize,
      page * pageSize - 1
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      data,
      meta: {
        page,
        pageSize,
        total: count || 0,
      },
    })
  } catch (error) {
    console.error('Get contracts error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/contracts - 上传合同
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'File is required' },
        { status: 400 }
      )
    }

    // 校验文件格式
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF and Word documents are supported' },
        { status: 400 }
      )
    }

    // 生成存储路径
    const fileId = uuidv4()
    const filePath = `contracts/${fileId}/${file.name}`

    // 上传文件到 Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('contracts')
      .upload(filePath, file, {
        contentType: file.type,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    // 创建合同记录
    const { data: contract, error } = await supabase
      .from('contracts')
      .insert({
        id: fileId,
        filename: file.name,
        storage_path: filePath,
        size: file.size,
        mime_type: file.type,
        status: 'PENDING',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(contract, { status: 201 })
  } catch (error) {
    console.error('Create contract error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
