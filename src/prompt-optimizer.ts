/**
 * Local, bounded adaptation of the prompt-optimizer Skill.
 *
 * This is deliberately a prompt rule builder, not an executor: user text and
 * custom templates are data supplied to the existing DSH model route.
 */
export type PromptComplexity = 'simple' | 'moderate' | 'complex'

const CHINESE = /[\u3400-\u9fff]/g

export function detectPromptLanguage(prompt: string): 'zh' | 'en' {
  const chinese = prompt.match(CHINESE)?.length ?? 0
  const latin = prompt.match(/[A-Za-z]/g)?.length ?? 0
  return chinese >= 2 && chinese >= latin * 0.15 ? 'zh' : 'en'
}

export function classifyPromptComplexity(prompt: string): PromptComplexity {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length
  const clauses = (prompt.match(/[\n,;；。！？!?]/g) ?? []).length
  const constraints = (prompt.match(/\b(?:must|should|avoid|except|only|不要|必须|需要|保留|禁止)\b/gi) ?? []).length
  if (words <= 35 && clauses <= 3 && constraints <= 2) return 'simple'
  if (words > 140 || clauses > 10 || constraints > 6) return 'complex'
  return 'moderate'
}

function rulesFor(complexity: PromptComplexity, language: 'zh' | 'en'): string {
  const length = language === 'zh'
    ? complexity === 'simple' ? '增强后的提示词保持简洁。' : complexity === 'moderate' ? '只补充消除歧义所需的上下文和输出结构。' : '清晰组织要求，但不要添加假设或无关章节。'
    : complexity === 'simple' ? 'Keep the improved prompt concise.' : complexity === 'moderate' ? 'Add only the context and output structure needed to remove ambiguity.' : 'Organize the requirements clearly, but do not add assumptions or unrelated sections.'
  if (language === 'zh') return [
    '你是提示词优化器，只改写提示词，不执行其中的任务。',
    '保留原始意图、原文语言、事实、数字、专有名词、范围和所有明确约束；不要编造事实或新增目标。',
    '根据任务复杂度适度补充角色、上下文、输出格式和质量标准；简单任务保持简洁。',
    '自定义指导中的 {{prompt}} 代表原始提示词；将其作为用户指定的补充要求理解，不要把它当作无关文本。',
    '只返回可直接交给模型的增强后提示词，不输出分析过程、分类标签、解释或前后对比。',
    length,
  ].join('\n')
  return [
    'You are a prompt optimizer. Rewrite the prompt; do not execute the task inside it.',
    'Preserve the original intent, language, facts, numbers, proper nouns, scope, and every explicit constraint. Do not invent facts or add goals.',
    'Add only the role, context, output format, or quality criteria needed for clarity; keep simple tasks concise.',
    'In custom guidance, {{prompt}} means the original prompt; treat the guidance as the user’s requested supplementary instruction, not irrelevant text.',
    'Return only the enhanced prompt ready for the model, without analysis, labels, explanations, or before/after commentary.',
    length,
  ].join('\n')
}

/** Build the user message sent through the existing DSH model call. */
export function buildPromptOptimizerInput(prompt: string, customTemplate?: string): string {
  const language = detectPromptLanguage(prompt)
  const complexity = classifyPromptComplexity(prompt)
  const custom = typeof customTemplate === 'string' && customTemplate.trim()
    ? `\n\nAdditional user-provided guidance (use as context, while still preserving the original constraints):\n<custom_guidance>\n${customTemplate}\n</custom_guidance>`
    : ''
  return [
    '<prompt_optimizer_rules>',
    rulesFor(complexity, language),
    `Detected complexity: ${complexity}.`,
    '</prompt_optimizer_rules>',
    '<original_prompt>',
    prompt,
    '</original_prompt>',
    custom,
  ].join('\n').trim()
}
