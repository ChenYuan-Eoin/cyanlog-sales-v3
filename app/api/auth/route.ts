import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

// POST /api/auth/register - 用户注册
export async function POST(req: NextRequest) {
  try {
    const { email, phone, password, name } = await req.json()

    if (!name || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (!email && !phone) {
      return NextResponse.json(
        { error: 'Email or phone is required' },
        { status: 400 }
      )
    }

    // 检查邮箱/手机号是否已注册
    if (email) {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single()

      if (existingUser) {
        return NextResponse.json(
          { error: 'Email already registered' },
          { status: 409 }
        )
      }
    }

    if (phone) {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('phone', phone)
        .single()

      if (existingUser) {
        return NextResponse.json(
          { error: 'Phone already registered' },
          { status: 409 }
        )
      }
    }

    // 密码加密
    const saltRounds = 12
    const passwordHash = await bcrypt.hash(password, saltRounds)

    // 创建用户
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        id: uuidv4(),
        email,
        phone,
        display_name: name,
        password_hash: passwordHash,
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      console.error('Registration error:', error)
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      )
    }

    // 生成 token
    const token = uuidv4()
    await supabase.from('auth_tokens').insert({
      id: uuidv4(),
      token,
      user_id: user.id,
      expires_at: null,
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
      },
      token,
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
