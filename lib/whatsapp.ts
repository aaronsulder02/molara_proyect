// Cliente mínimo de WhatsApp Cloud API (Meta) — solo fetch nativo.
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./supabase";

export const GRAPH_VERSION = process.env.API_VERSION || "v22.0";
// META_GRAPH_URL solo se usa en pruebas locales (Meta simulado); en producción es graph.facebook.com
export const GRAPH = `${(process.env.META_GRAPH_URL || "https://graph.facebook.com").replace(/\/$/, "")}/${GRAPH_VERSION}`;

export type WaAccount = {
  id?: string;
  clinic_id: string;
  phone_number_id: string;
  waba_id: string;
  access_token: string;
  display_phone?: string | null;
  app_id?: string | null;
  app_secret?: string | null;
};

/* ── Límites oficiales de mensajes interactivos ─────────────────────── */
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const LIMITS = { btnTitle: 20, rowTitle: 24, rowDesc: 72, listButton: 20, header: 60, footer: 60, body: 1024 };

export type Button = { id: string; title: string };
export type Row = { id: string; title: string; description?: string };
export type Section = { title?: string; rows: Row[] };

/* ── Constructores de payload ───────────────────────────────────────── */
export const wa = {
  text: (body: string) => ({ type: "text", text: { body: cut(body, 4096), preview_url: true } }),

  buttons: (body: string, buttons: Button[], opts: { header?: string; footer?: string } = {}) => ({
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts.header ? { header: { type: "text", text: cut(opts.header, LIMITS.header) } } : {}),
      body: { text: cut(body, LIMITS.body) },
      ...(opts.footer ? { footer: { text: cut(opts.footer, LIMITS.footer) } } : {}),
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: cut(b.title, LIMITS.btnTitle) } })),
      },
    },
  }),

  list: (body: string, button: string, sections: Section[], opts: { header?: string; footer?: string } = {}) => {
    // máx 10 filas en total
    let left = 10;
    const secs = sections
      .map((s) => {
        const rows = s.rows.slice(0, Math.max(0, left));
        left -= rows.length;
        return {
          ...(s.title ? { title: cut(s.title, 24) } : {}),
          rows: rows.map((r) => ({
            id: r.id,
            title: cut(r.title, LIMITS.rowTitle),
            ...(r.description ? { description: cut(r.description, LIMITS.rowDesc) } : {}),
          })),
        };
      })
      .filter((s) => s.rows.length);
    if (secs.length > 1) secs.forEach((s: any, i) => (s.title = s.title || `Opciones ${i + 1}`));
    return {
      type: "interactive",
      interactive: {
        type: "list",
        ...(opts.header ? { header: { type: "text", text: cut(opts.header, LIMITS.header) } } : {}),
        body: { text: cut(body, 4096) },
        ...(opts.footer ? { footer: { text: cut(opts.footer, LIMITS.footer) } } : {}),
        action: { button: cut(button, LIMITS.listButton), sections: secs },
      },
    };
  },

  cta: (body: string, displayText: string, url: string, opts: { header?: string; footer?: string } = {}) => ({
    type: "interactive",
    interactive: {
      type: "cta_url",
      ...(opts.header ? { header: { type: "text", text: cut(opts.header, LIMITS.header) } } : {}),
      body: { text: cut(body, LIMITS.body) },
      ...(opts.footer ? { footer: { text: cut(opts.footer, LIMITS.footer) } } : {}),
      action: { name: "cta_url", parameters: { display_text: cut(displayText, 20), url } },
    },
  }),

  location: (lat: number, lng: number, name: string, address: string) => ({
    type: "location",
    location: { latitude: lat, longitude: lng, name, address },
  }),

  template: (name: string, lang: string, components: any[] = []) => ({
    type: "template",
    template: { name, language: { code: lang }, components },
  }),
};

/** Resumen legible de un payload saliente (para guardarlo en la bandeja). */
export function describePayload(p: any): string {
  if (p.type === "text") return p.text.body;
  if (p.type === "template") return `📄 Plantilla: ${p.template.name}`;
  if (p.type === "interactive") {
    const i = p.interactive;
    const body = i.body?.text ?? "";
    if (i.type === "button") return `${body}\n${i.action.buttons.map((b: any) => `[${b.reply.title}]`).join(" ")}`;
    if (i.type === "list") return `${body}\n☰ ${i.action.button}`;
    if (i.type === "cta_url") return `${body}\n🔗 ${i.action.parameters.display_text}`;
    return body;
  }
  return p.type;
}

/* ── Envío ──────────────────────────────────────────────────────────── */
export async function sendWa(
  acc: WaAccount,
  to: string,
  payload: any,
  log?: { conversationId: string; author?: string }
): Promise<{ ok: boolean; id?: string; error?: string }> {
  let res: Response;
  let json: any = {};
  try {
    res = await fetch(`${GRAPH}/${acc.phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
    });
    json = await res.json().catch(() => ({}));
  } catch (e: any) {
    json = { error: { message: e?.message || "Error de red" } };
    res = new Response(null, { status: 599 });
  }
  const ok = res.ok && json?.messages?.[0]?.id;
  const error = ok ? undefined : json?.error?.error_data?.details || json?.error?.message || `HTTP ${res.status}`;

  if (log?.conversationId) {
    const body = describePayload(payload);
    await db().from("messages").insert({
      clinic_id: acc.clinic_id,
      conversation_id: log.conversationId,
      direction: "out",
      author: log.author ?? "bot",
      type: payload.type,
      body,
      payload,
      wa_message_id: ok ? json.messages[0].id : null,
      status: ok ? "sent" : "failed",
      error: error ?? null,
    });
    await db()
      .from("conversations")
      .update({ last_message: body.slice(0, 140), last_message_at: new Date().toISOString() })
      .eq("id", log.conversationId);
  }
  if (!ok) console.error("[whatsapp] envío fallido:", error);
  return ok ? { ok: true, id: json.messages[0].id } : { ok: false, error };
}

/** Marca como leído y muestra "escribiendo…" al paciente. */
export async function markReadTyping(acc: WaAccount, messageId: string) {
  try {
    await fetch(`${GRAPH}/${acc.phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
    });
  } catch {}
}

/* ── Seguridad del webhook ──────────────────────────────────────────── */
/** Valida X-Hub-Signature-256 contra una lista de App Secrets candidatos.
 *  Cada consultorio conecta su propia app de Meta, por lo que el webhook acepta la firma
 *  del App Secret del consultorio dueño del número (o el de la plataforma). */
export function verifySignature(raw: string, header: string | null, secrets: (string | null | undefined)[] = [process.env.META_APP_SECRET]): boolean {
  const list = [...new Set(secrets.filter((s): s is string => !!s))];
  if (!list.length) return process.env.NODE_ENV !== "production"; // sin secretos: solo se tolera en desarrollo
  if (!header?.startsWith("sha256=")) return false;
  const got = header.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(got)) return false;
  return list.some((secret) => {
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  });
}

/* ── Gestión de la cuenta (formulario de conexión) ──────────────────── */
export async function fetchPhoneInfo(phoneNumberId: string, token: string) {
  const r = await fetch(
    `${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Meta respondió ${r.status}`);
  return j as { display_phone_number: string; verified_name: string; quality_rating?: string; id: string };
}

/** Suscribe la app de la plataforma a la WABA del cliente para recibir su webhook. */
export async function subscribeApp(wabaId: string, token: string) {
  const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Meta respondió ${r.status}`);
  return j;
}

export async function listTemplates(wabaId: string, token: string) {
  const r = await fetch(`${GRAPH}/${wabaId}/message_templates?fields=name,status,language,category&limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Meta respondió ${r.status}`);
  return (j.data ?? []) as { name: string; status: string; language: string; category: string }[];
}

export async function getAccountByPhoneId(phoneNumberId: string) {
  const { data } = await db().from("whatsapp_accounts").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
  return data as (WaAccount & { id: string }) | null;
}

export async function getAccountsByPhoneIds(ids: string[]) {
  if (!ids.length) return [];
  const { data } = await db().from("whatsapp_accounts").select("*").in("phone_number_id", ids);
  return (data ?? []) as (WaAccount & { id: string })[];
}

export async function getAccountByClinic(clinicId: string) {
  const { data } = await db().from("whatsapp_accounts").select("*").eq("clinic_id", clinicId).maybeSingle();
  return data as (WaAccount & { id: string; display_phone: string; verified_name: string; status: string; last_error: string; quality_rating: string;
    webhook_status: string; webhook_url: string | null; webhook_verified_at: string | null; webhook_last_event_at: string | null;
    token_expires_at: string | null; setup_report: any; setup_at: string | null; webhook_verify_token: string | null }) | null;
}
