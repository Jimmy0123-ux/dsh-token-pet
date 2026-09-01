export interface PromptRouteSelection { provider?: string; model?: string }

/** Resolve an enhancement call from the active session route, then DSH defaults. */
export function resolvePromptRoute(
  request: PromptRouteSelection,
  defaults: PromptRouteSelection,
  providers: ReadonlyArray<{ id: string }>,
): PromptRouteSelection {
  const provider = request.provider ?? defaults.provider ?? (providers.length === 1 ? providers[0]?.id : undefined)
  const model = request.model ?? (provider === defaults.provider ? defaults.model : undefined)
  return { provider, model }
}
