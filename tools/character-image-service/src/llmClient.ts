import OpenAI from 'openai'

const MODEL = 'gpt-5.4'
const TEMPERATURE = 0.7
const MAX_COMPLETION_TOKENS = 4096

const stripMarkdownFences = (text: string): string => {
  const fenced = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/)
  return fenced ? fenced[1].trim() : text.trim()
}

export const generateCharacterYaml = async (
  systemPrompt: string,
  userMessage: string,
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for character draft generation')
  }

  const client = new OpenAI({ apiKey })

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('OpenAI returned an empty response')
  }

  return stripMarkdownFences(content)
}

export const retryWithFeedback = async (
  systemPrompt: string,
  userMessage: string,
  previousYaml: string,
  validationError: string,
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for character draft generation')
  }

  const client = new OpenAI({ apiKey })

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: previousYaml },
      {
        role: 'user',
        content: `Das YAML hat einen Validierungsfehler: ${validationError}\n\nBitte korrigiere das YAML und gib nur das korrigierte YAML zurueck.`,
      },
    ],
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('OpenAI returned an empty response on retry')
  }

  return stripMarkdownFences(content)
}
