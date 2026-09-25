// Conexión automática con Meta: valida las credenciales del consultorio y configura
// el webhook de su cuenta de WhatsApp hacia Molara, sin pasos manuales en Meta.
//
// Mecanismo (API oficial de Meta):
//  1. GET  /debug_token                      → el token es válido, de esa app, con permisos y acceso a la WABA
//  2. GET  /{phone-id}  y  /{waba}/phone_numbers → el número existe y pertenece a la WABA
//  3. GET/POST /{app-id}/subscriptions       → la app escucha el campo "messages" (token de app)
//  4. POST /{waba}/subscribed_apps           → suscribe la app a la WABA con override_callback_uri
//                                              (ruta exclusiva hacia Molara; Meta la verifica al instante)
//  5. GET  /{phone-id}?fields=webhook_configuration → confirma a dónde enviará Meta los mensajes
import { randomBytes } from "node:crypto";
import { GRAPH, fetchPhoneInfo } from "./whatsapp";
import { db } from "./supabase";

export type StepState = "ok" | "warn" | "error" | "skip";
export type Step = { key: string; label: string; state: StepState; detail: string };
export type SetupReport = { steps: Step[]; at: string; webhookUrl: string | null };

export type Credentials = {
  phoneNumberId: string;
  wabaId: string;
  token: string;
  appId: string;
  appSecret: string;
};

/* ── URL pública de la plataforma ──────────────────────────────────── */
export function publicAppUrl(): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  return (env || vercel).replace(/\/$/, "");
}

export function isPublicHttps(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    if (!h.includes(".") || h === "localhost") return false;
    return !/^(127\.|10\.|192\.168\.|0\.0\.0\.0|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  } catch {
    return false;
  }
}

export const webhookUrlFor = (base = publicAppUrl()) => `${base}/api/whatsapp/webhook`;
export const newVerifyToken = () => "molara_" + randomBytes(24).toString("hex");

/* ── Cliente Graph con errores legibles ────────────────────────────── */
type GraphRes = { ok: boolean; status: number; json: any; error?: string; code?: number; subcode?: number };

async function graph(
  path: string,
  opts: { method?: "GET" | "POST" | "DELETE"; bearer?: string; appToken?: string; json?: any; form?: Record<string, string>; query?: Record<string, string> } = {}
): Promise<GraphRes> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.form) {
    const f = new URLSearchParams(opts.form);
    if (opts.appToken) f.set("access_token", opts.appToken);
    body = f.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else {
    if (opts.appToken) url.searchParams.set("access_token", opts.appToken);
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["Content-Type"] = "application/json";
    }
  }
  try {
    const r = await fetch(url, { method: opts.method ?? "GET", headers, body, cache: "no-store" });
    const json = await r.json().catch(() => ({}));
    const e = json?.error;
    return { ok: r.ok && !e, status: r.status, json, error: e ? e.error_user_msg || e.message : r.ok ? undefined : `Meta respondió ${r.status}`, code: e?.code, subcode: e?.error_subcode };
  } catch (err: any) {
    return { ok: false, status: 0, json: null, error: `No se pudo contactar a Meta (${err?.message || err})` };
  }
}

/** Traduce los errores más comunes de Meta a instrucciones concretas. */
export function friendly(r: GraphRes, context: "token" | "app" | "phone" | "waba" | "webhook"): string {
  const m = (r.error || "").toLowerCase();
  if (r.status === 0) return r.error!;
  if (context === "app" && (m.includes("secret") || m.includes("application") || r.code === 1 || r.code === 101))
    return "El App ID o el App Secret no son correctos. Cópialos desde Meta for Developers → tu app → Configuración de la app → Básica.";
  if (r.code === 190 || m.includes("expired") || m.includes("session has expired"))
    return "El token de acceso expiró o no es válido. Genera uno nuevo (idealmente permanente, desde Usuarios del sistema).";
  if (r.code === 10 || r.code === 200 || m.includes("permission"))
    return `El token no tiene permisos suficientes (${r.error}). Debe incluir whatsapp_business_messaging y whatsapp_business_management.`;
  if (r.code === 100 && context === "phone") return "Meta no encontró ese Phone Number ID con este token. Revisa el número copiado.";
  if (r.code === 100 && context === "waba") return "Meta no encontró ese WhatsApp Business Account ID con este token.";
  if (context === "webhook" && (m.includes("verify") || m.includes("callback") || m.includes("validate")))
    return `Meta no pudo verificar la URL del webhook (${r.error}). Revisa que la plataforma esté publicada y accesible.`;
  return r.error || "Error desconocido de Meta";
}

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(d);

/* ── 1) Validación de credenciales ─────────────────────────────────── */
export type Inspection = {
  steps: Step[];
  fatal: string | null;
  info?: { display_phone_number: string; verified_name: string; quality_rating?: string };
  tokenExpiresAt: string | null;
};

export async function inspectCredentials(c: Credentials): Promise<Inspection> {
  const steps: Step[] = [];
  const appToken = `${c.appId}|${c.appSecret}`;
  let tokenExpiresAt: string | null = null;
  const fatalOut = (key: string, label: string, detail: string): Inspection => {
    steps.push({ key, label, state: "error", detail });
    return { steps, fatal: detail, tokenExpiresAt };
  };

  // Token + app (debug_token con el token de app valida también el App Secret)
  const dbg = await graph("debug_token", { appToken, query: { input_token: c.token } });
  if (!dbg.ok) return fatalOut("token", "App y token de Meta", friendly(dbg, "app"));
  const d = dbg.json?.data ?? {};
  if (!d.is_valid)
    return fatalOut("token", "App y token de Meta", "El token de acceso no es válido o expiró. Copia nuevamente el token (idealmente uno permanente de Usuario del sistema) y vuelve a intentarlo.");
  if (d.app_id && String(d.app_id) !== c.appId)
    return fatalOut("token", "App y token de Meta", `El token pertenece a otra app (App ID ${d.app_id}). Usa el App ID y App Secret de la app con la que generaste el token.`);
  const scopes: string[] = d.scopes ?? [];
  const missing = ["whatsapp_business_messaging", "whatsapp_business_management"].filter((s) => !scopes.includes(s));
  if (missing.length) return fatalOut("token", "App y token de Meta", `Al token le faltan permisos: ${missing.join(", ")}. Vuelve a generarlo marcándolos.`);
  const gs = (d.granular_scopes ?? []).find((g: any) => g.scope === "whatsapp_business_management");
  if (gs?.target_ids?.length && !gs.target_ids.map(String).includes(c.wabaId))
    return fatalOut("token", "App y token de Meta", `El token no tiene acceso a la cuenta de WhatsApp ${c.wabaId}. Al generarlo, asígnale esa cuenta (activo) al Usuario del sistema.`);
  const exp = Number(d.expires_at || 0);
  if (exp > 0) {
    tokenExpiresAt = new Date(exp * 1000).toISOString();
    steps.push({ key: "token", label: "App y token de Meta", state: "warn", detail: `Credenciales válidas, pero el token es temporal: vence el ${fmtDate(new Date(exp * 1000))}. Reemplázalo por un token permanente para que el bot no se detenga.` });
  } else {
    steps.push({ key: "token", label: "App y token de Meta", state: "ok", detail: `Token permanente de la app ${d.application ? `“${d.application}”` : c.appId}, con los permisos necesarios.` });
  }

  // Número
  let info;
  try {
    info = await fetchPhoneInfo(c.phoneNumberId, c.token);
  } catch (e: any) {
    return fatalOut("phone", "Número de WhatsApp", friendly({ ok: false, status: 400, json: null, error: e.message, code: /does not exist|unsupported get/i.test(e.message) ? 100 : undefined }, "phone"));
  }
  steps.push({ key: "phone", label: "Número de WhatsApp", state: "ok", detail: `${info.verified_name} · ${info.display_phone_number}` });

  // El número pertenece a la WABA
  const nums = await graph(`${c.wabaId}/phone_numbers`, { bearer: c.token, query: { fields: "id,display_phone_number", limit: "100" } });
  if (!nums.ok) return fatalOut("waba", "Cuenta de WhatsApp Business", friendly(nums, "waba"));
  const ids: string[] = (nums.json?.data ?? []).map((n: any) => String(n.id));
  if (!ids.includes(c.phoneNumberId))
    return fatalOut("waba", "Cuenta de WhatsApp Business", `El número ${info.display_phone_number} no pertenece a la cuenta ${c.wabaId}. Revisa el WhatsApp Business Account ID.`);
  steps.push({ key: "waba", label: "Cuenta de WhatsApp Business", state: "ok", detail: `El número pertenece a la cuenta ${c.wabaId}.` });

  return { steps, fatal: null, info, tokenExpiresAt };
}

/* ── 2) Configuración automática del webhook ───────────────────────── */
export type WebhookResult = { steps: Step[]; status: "active" | "pending" | "error"; webhookUrl: string | null; error: string | null };

export async function configureWebhook(c: Credentials & { verifyToken: string; clinicId: string }, base = publicAppUrl()): Promise<WebhookResult> {
  const steps: Step[] = [];
  const url = webhookUrlFor(base);
  if (!isPublicHttps(base)) {
    steps.push({
      key: "webhook",
      label: "Webhook automático",
      state: "skip",
      detail: `Se activará solo cuando la plataforma esté publicada en una URL https (ahora es ${base || "sin URL"}; Meta no puede llamar a un computador local).`,
    });
    return { steps, status: "pending", webhookUrl: null, error: null };
  }
  const appToken = `${c.appId}|${c.appSecret}`;
  const started = new Date(Date.now() - 2000).toISOString();

  // a) La app debe escuchar el campo "messages"
  const subs = await graph(`${c.appId}/subscriptions`, { appToken });
  const wabaSub = (subs.json?.data ?? []).find((s: any) => s.object === "whatsapp_business_account");
  const hasMessages = (s: any) => (s?.fields ?? []).some((f: any) => (typeof f === "string" ? f : f?.name) === "messages");
  if (wabaSub && wabaSub.active !== false && hasMessages(wabaSub)) {
    steps.push({
      key: "app_sub",
      label: "Eventos de la app",
      state: "ok",
      detail: wabaSub.callback_url === url ? "La app ya enviaba mensajes a Molara." : "La app ya escucha mensajes; se conserva su configuración actual y Molara usa una ruta exclusiva para tu número.",
    });
  } else if (wabaSub && wabaSub.callback_url && wabaSub.callback_url !== url && wabaSub.active !== false) {
    steps.push({
      key: "app_sub",
      label: "Eventos de la app",
      state: "warn",
      detail: `Tu app tiene su propio webhook (${wabaSub.callback_url}) sin el campo “messages”. No lo modificamos para no romper otra integración: actívalo en Meta → WhatsApp → Configuración, o usa una app dedicada a Molara.`,
    });
  } else {
    const set = await graph(`${c.appId}/subscriptions`, {
      method: "POST",
      appToken,
      form: { object: "whatsapp_business_account", callback_url: url, verify_token: c.verifyToken, fields: "messages", include_values: "true" },
    });
    steps.push(
      set.ok
        ? { key: "app_sub", label: "Eventos de la app", state: "ok", detail: "Webhook de la app creado y suscrito al campo “messages”." }
        : { key: "app_sub", label: "Eventos de la app", state: "warn", detail: `No se pudo suscribir la app al campo “messages” (${friendly(set, "webhook")}).` }
    );
  }

  // b) Suscribir la app a la WABA con ruta exclusiva hacia Molara (Meta verifica la URL en este paso)
  const ov = await graph(`${c.wabaId}/subscribed_apps`, { method: "POST", bearer: c.token, json: { override_callback_uri: url, verify_token: c.verifyToken } });
  if (!ov.ok) {
    const detail = friendly(ov, "webhook");
    steps.push({ key: "override", label: "Ruta de mensajes hacia Molara", state: "error", detail });
    return { steps, status: "error", webhookUrl: url, error: detail };
  }
  steps.push({ key: "override", label: "Ruta de mensajes hacia Molara", state: "ok", detail: `Tu cuenta de WhatsApp envía los mensajes a ${url}` });

  // c) Confirmar la ruta efectiva del número (si el número tiene una ruta propia distinta, se corrige)
  const readCfg = async () => {
    const r = await graph(c.phoneNumberId, { bearer: c.token, query: { fields: "webhook_configuration" } });
    const w = r.json?.webhook_configuration ?? {};
    return { r, effective: w.phone_number || w.whatsapp_business_account || w.application || null };
  };
  let cfg = await readCfg();
  if (cfg.r.ok && cfg.effective && cfg.effective !== url) {
    await graph(c.phoneNumberId, { method: "POST", bearer: c.token, json: { webhook_configuration: { override_callback_uri: url, verify_token: c.verifyToken } } });
    cfg = await readCfg();
  }
  if (!cfg.r.ok) {
    steps.push({ key: "confirm", label: "Confirmación de Meta", state: "warn", detail: `No se pudo leer la configuración final (${friendly(cfg.r, "webhook")}).` });
  } else if (cfg.effective !== url) {
    const detail = `Meta sigue enviando los mensajes de este número a ${cfg.effective || "ninguna URL"}.`;
    steps.push({ key: "confirm", label: "Confirmación de Meta", state: "error", detail });
    return { steps, status: "error", webhookUrl: url, error: detail };
  } else {
    steps.push({ key: "confirm", label: "Confirmación de Meta", state: "ok", detail: "Meta confirma que los mensajes de este número llegan a Molara." });
  }

  // d) ¿Meta llamó efectivamente a nuestro endpoint de verificación?
  const { data: row } = await db().from("whatsapp_accounts").select("webhook_verified_at").eq("clinic_id", c.clinicId).maybeSingle();
  const verified = row?.webhook_verified_at && row.webhook_verified_at >= started;
  steps.push(
    verified
      ? { key: "handshake", label: "Verificación del webhook", state: "ok", detail: "Meta llamó a Molara y la verificación fue exitosa." }
      : { key: "handshake", label: "Verificación del webhook", state: "warn", detail: "Meta aceptó la configuración; la primera llamada de verificación puede tardar unos segundos." }
  );

  return { steps, status: "active", webhookUrl: url, error: null };
}

/** Quita la ruta exclusiva al desconectar (mejor esfuerzo). */
export async function removeOverride(wabaId: string, token: string) {
  await graph(`${wabaId}/subscribed_apps`, { method: "POST", bearer: token });
}

/* ── 3) Orquestación completa (usada por el formulario, el botón y el cron) ── */
export async function runSetup(clinicId: string, c: Credentials, opts: { base?: string } = {}) {
  const inspection = await inspectCredentials(c);
  if (inspection.fatal) return { ok: false as const, error: inspection.fatal, steps: inspection.steps };

  const { data: existing } = await db().from("whatsapp_accounts").select("webhook_verify_token").eq("clinic_id", clinicId).maybeSingle();
  const verifyToken = existing?.webhook_verify_token || newVerifyToken();

  // Se guarda ANTES de configurar el webhook: Meta llamará a /api/whatsapp/webhook con este verify_token.
  const base = {
    clinic_id: clinicId,
    phone_number_id: c.phoneNumberId,
    waba_id: c.wabaId,
    access_token: c.token,
    app_id: c.appId,
    app_secret: c.appSecret,
    webhook_verify_token: verifyToken,
    display_phone: inspection.info!.display_phone_number,
    verified_name: inspection.info!.verified_name,
    quality_rating: inspection.info!.quality_rating ?? null,
    token_expires_at: inspection.tokenExpiresAt,
    status: "connected",
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("whatsapp_accounts").upsert(base, { onConflict: "clinic_id" });
  if (error) return { ok: false as const, error: error.message, steps: inspection.steps };

  const wh = await configureWebhook({ ...c, verifyToken, clinicId }, opts.base);
  const steps = [...inspection.steps, ...wh.steps];
  const report: SetupReport = { steps, at: new Date().toISOString(), webhookUrl: wh.webhookUrl };
  const warn = steps.find((s) => s.state === "warn");
  await db()
    .from("whatsapp_accounts")
    .update({
      webhook_status: wh.status,
      webhook_url: wh.webhookUrl,
      setup_report: report,
      setup_at: report.at,
      last_error: wh.error ?? warn?.detail ?? null,
      updated_at: report.at,
    })
    .eq("clinic_id", clinicId);

  return { ok: true as const, status: wh.status, steps, info: inspection.info!, error: wh.error };
}
