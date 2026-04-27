/**
 * Approximate cost per 1M tokens for common models.
 * Prices in USD — update as providers change pricing.
 */
interface ModelPricing {
  input:  number   // $ per 1M input tokens
  output: number   // $ per 1M output tokens
}

const PRICING: Record<string, ModelPricing> = {
  // Claude
  'claude-opus-4-6':             { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':           { input:  3.00, output: 15.00 },
  'claude-haiku-4-5-20251001':   { input:  0.25, output:  1.25 },
  // OpenAI
  'gpt-4o':                      { input:  2.50, output: 10.00 },
  'gpt-4o-mini':                 { input:  0.15, output:  0.60 },
  'o1':                          { input: 15.00, output: 60.00 },
  'o1-mini':                     { input:  3.00, output: 12.00 },
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = PRICING[model]
  if (!pricing) return null
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `<$0.01`
  if (usd < 1)    return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
