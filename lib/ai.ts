// Vercel AI Gateway (endpoint compatible con OpenAI Chat Completions) — fetch nativo, sin SDK.
const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

export function aiToken(): string | null {
  return process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || null;
}

export function aiAvailable() {
  return !!aiToken();
}

export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  run: (args: any) => Promise<any>;
};

/**
 * Bucle agente: el modelo llama herramientas hasta producir una respuesta final.
 * Devuelve el texto final (puede ser vacío si una herramienta ya respondió al paciente).
 */
export async function runAgent(opts: {
  system: string;
  history: ChatMsg[];
  tools: ToolDef[];
  model?: string;
  maxSteps?: number;
}): Promise<string> {
  const token = aiToken();
  if (!token) throw new Error("AI Gateway no configurado");
  const model = opts.model || process.env.AI_MODEL || "openai/gpt-4.1-mini";
  const messages: ChatMsg[] = [{ role: "system", content: opts.system }, ...opts.history];
  const toolSpecs = opts.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    const r = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: toolSpecs, tool_choice: "auto", temperature: 0.3, max_tokens: 600 }),
    });
    if (!r.ok) throw new Error(`AI Gateway ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error("Respuesta vacía del modelo");

    const calls: ToolCall[] = msg.tool_calls ?? [];
    if (!calls.length) return (msg.content ?? "").trim();

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const c of calls) {
      const tool = opts.tools.find((t) => t.name === c.function.name);
      let result: any;
      try {
        const args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        result = tool ? await tool.run(args) : { error: "herramienta desconocida" };
      } catch (e: any) {
        result = { error: e?.message || "error" };
      }
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return "";
}

/**
 * Extracción estructurada: devuelve el JSON que produce el modelo (o null si falla).
 * Temperatura 0 y salida corta; se usa para llenar el formulario de reserva desde texto o voz.
 */
export async function completeJson(system: string, user: string): Promise<any | null> {
  const token = aiToken();
  if (!token) return null;
  try {
    const r = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_NLU_MODEL || process.env.AI_MODEL || "openai/gpt-4.1-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0,
        max_tokens: 220,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const raw = String(j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
