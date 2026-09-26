// Notas de voz de WhatsApp: descarga desde Meta + transcripción con Vercel AI Gateway (fetch nativo).
//
// 1) Speech-to-Text dedicado del AI Gateway (POST /v4/ai/transcription-model, audio en base64).
// 2) Respaldo: modelo multimodal por Chat Completions con el audio como parte "file"
//    (útil si el STT aún no está habilitado para el equipo o falla).
import { GRAPH, type WaAccount } from "./whatsapp";
import { aiToken } from "./ai";

const GATEWAY = "https://ai-gateway.vercel.sh";
const MAX_BYTES = 16 * 1024 * 1024; // límite de audio de WhatsApp

export async function downloadWaMedia(acc: WaAccount, mediaId: string): Promise<{ data: Buffer; mime: string }> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${acc.access_token}` }, cache: "no-store" });
  const info = await meta.json().catch(() => ({}));
  if (!meta.ok || !info?.url) throw new Error(info?.error?.message || `No se pudo obtener el audio (${meta.status})`);
  if (Number(info.file_size) > MAX_BYTES) throw new Error("Audio demasiado largo");
  const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${acc.access_token}` }, cache: "no-store" });
  if (!bin.ok) throw new Error(`No se pudo descargar el audio (${bin.status})`);
  const data = Buffer.from(await bin.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error("Audio demasiado largo");
  return { data, mime: String(info.mime_type || bin.headers.get("content-type") || "audio/ogg") };
}

const cleanMime = (m: string) => (m.split(";")[0].trim() || "audio/ogg").toLowerCase();

async function viaSpeechToText(data: Buffer, mediaType: string, token: string): Promise<string> {
  const r = await fetch(`${GATEWAY}/v4/ai/transcription-model`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-transcription-model-specification-version": "4",
      "ai-model-id": process.env.AI_STT_MODEL || "openai/gpt-4o-transcribe",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audio: data.toString("base64"), mediaType, providerOptions: { openai: { language: "es" } } }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`STT ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return String(j.text ?? "").trim();
}

async function viaMultimodalChat(data: Buffer, mediaType: string, token: string): Promise<string> {
  const ext = mediaType.split("/")[1]?.replace("mpeg", "mp3") || "ogg";
  const r = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_AUDIO_MODEL || "google/gemini-3.6-flash",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe literalmente esta nota de voz (español de Chile). Responde SOLO con la transcripción, sin comillas ni comentarios. Si no se entiende nada, responde vacío." },
            { type: "file", file: { filename: `nota.${ext}`, file_data: `data:${mediaType};base64,${data.toString("base64")}` } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Audio chat ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return String(j.choices?.[0]?.message?.content ?? "").trim();
}

/** Transcribe una nota de voz. Devuelve "" si no hay IA o no se entendió nada. */
export async function transcribeAudio(data: Buffer, mime: string): Promise<{ text: string; via: "stt" | "chat" | "none" }> {
  const token = aiToken();
  if (!token) return { text: "", via: "none" };
  const mediaType = cleanMime(mime);
  try {
    const text = await viaSpeechToText(data, mediaType, token);
    if (text) return { text, via: "stt" };
  } catch (e) {
    console.warn("[voice] STT falló, uso respaldo multimodal:", (e as Error).message);
  }
  try {
    return { text: await viaMultimodalChat(data, mediaType, token), via: "chat" };
  } catch (e) {
    console.error("[voice] transcripción no disponible:", (e as Error).message);
    return { text: "", via: "none" };
  }
}
