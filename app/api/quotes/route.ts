import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

// GET /api/quotes - 获取报价列表
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    let query = supabase
      .from('quotes')
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
    console.error('Get quotes error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/quotes - 创建报价
export async function POST(req: NextRequest) {
  try {
    const { customer_name, customer_contact, valid_until } = await req.json()

    if (!customer_name) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      )
    }

    const quoteNo = `QT-${Date.now()}-${Math.floor(Math.random() * 1000)}`

    const { data: quote, error } = await supabase
      .from('quotes')
      .insert({
        id: uuidv4(),
        quote_no: quoteNo,
        customer_name,
        customer_contact,
        status: 'DRAFT',
        valid_until,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(quote, { status: 201 })
  } catch (error) {
    console.error('Create quote error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
