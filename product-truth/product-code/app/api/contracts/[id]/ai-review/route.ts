// REQ:F005 + AI Streaming
// PURPOSE: Stream AI contract review results using Vercel AI SDK

import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export const runtime = 'edge'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    const contractId = params.id

    // Fetch contract with owner verification
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('id, filename, parsed_text, created_by')
      .eq('id', contractId)
      .eq('created_by', user.id)
      .single()

    if (error || !contract) {
      return NextResponse.json(
        { error: 'Contract not found or access denied' },
        { status: 404 }
      )
    }

    const contractText = contract.parsed_text || 'No text available for review'

    // Stream AI review using Claude
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      messages: [
        {
          role: 'system',
          content: `You are a legal contract review expert. Analyze the contract and identify risks.
Return your analysis in this JSON format:
{
  "risks": [
    {
      "level": "red|yellow|green",
      "title": "Brief risk title",
      "description": "Detailed description of the issue",
      "suggestion": "Recommended action"
    }
  ],
  "summary": "Overall assessment summary"
}`,
        },
        {
          role: 'user',
          content: `Please review this contract:\n\n${contractText.substring(0, 8000)}`,
        },
      ],
      maxOutputTokens: 4000,
      temperature: 0.3,
    })

    // Return streaming response
    return result.toTextStreamResponse()

  } catch (error) {
    console.error('[AI Review] Error:', error)

    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'AI review failed' },
      { status: 500 }
    )
  }
}
