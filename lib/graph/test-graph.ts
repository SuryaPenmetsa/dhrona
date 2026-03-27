import { extractAndSaveGraph } from './extract'
import { getTopicContext, formatContextForPrompt } from './context'

const MOCK_SESSION = {
  childKey: 'boy' as const,
  episodeId: 'test-episode-001',
  subject: 'Mathematics',
  topic: 'Quadratic Equations',
  grade: 'Grade 6',
  messages: [
    {
      role: 'user' as const,
      content: 'I know that quadratics make parabola shapes but I have no idea why',
    },
    {
      role: 'assistant' as const,
      content:
        'Good starting point. Have you ever watched a basketball shot? The ball traces a curved path through the air. That curve is a parabola — the same shape as a quadratic equation.',
    },
    {
      role: 'user' as const,
      content: "Oh wait so the basketball shot is literally the same as y equals x squared? That's actually wild",
    },
    {
      role: 'assistant' as const,
      content:
        'Exactly. In Physics you will study projectile motion — that is the same mathematics. The equation tells you where the ball will be at any moment. Now tell me: what do you think the vertex of the parabola represents in the basketball example?',
    },
    {
      role: 'user' as const,
      content: 'Is it the highest point of the shot?',
    },
    {
      role: 'assistant' as const,
      content:
        'Correct. And that is also the maximum or minimum of the quadratic. Now there is one thing I want to check — do you understand what happens when the discriminant is less than zero?',
    },
    {
      role: 'user' as const,
      content: "Not really... I get that it means no real roots but I don't understand WHY",
    },
  ],
}

async function main() {
  console.log('\n--- TEST 1: Extract graph from session ---\n')
  const extraction = await extractAndSaveGraph(MOCK_SESSION)
  console.log('Extracted:', JSON.stringify(extraction, null, 2))

  console.log('\n--- TEST 2: Retrieve context for next session ---\n')
  const context = await getTopicContext({
    childKey: 'boy',
    subject: 'Mathematics',
    topic: 'Quadratic Equations',
  })
  console.log('Context:', JSON.stringify(context, null, 2))

  console.log('\n--- TEST 3: Format for system prompt injection ---\n')
  const formatted = formatContextForPrompt(context)
  console.log(formatted)
}

main().catch(console.error)
