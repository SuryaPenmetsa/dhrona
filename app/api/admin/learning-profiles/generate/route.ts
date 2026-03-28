import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { AuthzError, requireAdmin } from '@/lib/auth/admin'
import { getLlmSettingsWithServiceClient } from '@/lib/llm/settings'

export async function POST(request: Request) {
  try {
    await requireAdmin()
    const body = (await request.json()) as {
      childName?: string
      personalitySummary?: string
      learningGoals?: string
      constraints?: string
    }

    const childName = body.childName?.trim() || 'the learner'
    const personalitySummary = body.personalitySummary?.trim()
    const learningGoals = body.learningGoals?.trim() || ''
    const constraints = body.constraints?.trim() || ''

    if (!personalitySummary) {
      return NextResponse.json({ error: 'Provide personality summary.' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY.' }, { status: 500 })
    }

    const llmSettings = await getLlmSettingsWithServiceClient()
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: llmSettings.profileGenerationModelId,
      max_tokens: 900,
      system:
        'You create tutoring behavior instructions for another LLM. ' +
        'Output rich-text markdown that is concise, practical, and directly usable as a system instruction block.',
      messages: [
        {
          role: 'user',
          content: `Create LLM tutoring instructions for ${childName}.

Personality summary:
${personalitySummary}

Learning goals:
${learningGoals || 'Not specified'}

Constraints:
${constraints || 'Not specified'}

Output format requirements:
- Use markdown with short sections and bullets.
- Include: communication style, pacing, motivation strategy, struggle handling, assessment/check questions, and "do not do" behaviors.
- Keep it specific enough that another LLM can follow it immediately.
- Keep total length under 450 words.
- Do not include any preamble.`,
        },
      ],
    })

    const instructions = response.content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n')
      .trim()

    if (!instructions) {
      return NextResponse.json({ error: 'Claude returned empty instructions.' }, { status: 500 })
    }

    return NextResponse.json({ instructions })
  } catch (err) {
    if (err instanceof AuthzError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate instructions' },
      { status: 500 }
    )
  }
}
