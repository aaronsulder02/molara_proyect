// Meta Graph API simulada (solo pruebas locales) — reproduce el comportamiento oficial relevante:
//  · debug_token con token de app (valida App Secret), permisos y granular_scopes
//  · /{app}/subscriptions (token de app) con verificación GET real al callback
//  · /{waba}/subscribed_apps con override_callback_uri + verify_token (verificación real)
//  · /{phone}?fields=webhook_configuration  y  POST /{phone} webhook_configuration
//  · precedencia de rutas: número > WABA > app
//  · entrega de eventos firmados con X-Hub-Signature-256 usando el App Secret de la app suscrita
import http from "node:http";
import { createHmac, randomBytes } from "node:crypto";

const PORT = Number(process.env.META_PORT || 5555);
// Las URLs públicas (https://molara.test) se redirigen al servidor Next local
const PUBLIC_BASE = process.env.PUBLIC_BASE || "https://molara.test";
const LOCAL_BASE = process.env.LOCAL_BASE || "http://127.0.0.1:3100";

export const F = {
  APP_A: "900000000000001", SECRET_A: "a1".repeat(16),
  APP_B: "900000000000002", SECRET_B: "b2".repeat(16),
  WABA_A: "700000000000001", WABA_B: "700000000000002",
  PHONE_A: "600000000000001", PHONE_B: "600000000000002",
  TOK_PERM: "EAA_perm_A", TOK_TEMP: "EAA_temp_A", TOK_NOPERM: "EAA_noperm_A", TOK_OTHERWABA: "EAA_otherwaba_A", TOK_B: "EAA_perm_B",
};

type Sub = { callback_url: string; fields: string[]; verify_token: string; active: boolean };
const state: any = {
  apps: {
    [F.APP_A]: { name: "Clínica Sonrisa App", secret: F.SECRET_A, subscriptions: {} as Record<string, Sub> },
    [F.APP_B]: { name: "App con CRM", secret: F.SECRET_B, subscriptions: { whatsapp_business_account: { callback_url: "https://otro-crm.example/hook", fields: ["messages"], verify_token: "x", active: true } } },
  },
  tokens: {
    [F.TOK_PERM]: { app: F.APP_A, scopes: ["whatsapp_business_messaging", "whatsapp_business_management"], targets: [F.WABA_A, F.WABA_B], exp: 0 },
    [F.TOK_TEMP]: { app: F.APP_A, scopes: ["whatsapp_business_messaging", "whatsapp_business_management"], targets: [F.WABA_A], exp: Math.floor(Date.now() / 1000) + 23 * 3600 },
    [F.TOK_NOPERM]: { app: F.APP_A, scopes: ["whatsapp_business_messaging"], targets: [F.WABA_A], exp: 0 },
    [F.TOK_OTHERWABA]: { app: F.APP_A, scopes: ["whatsapp_business_messaging", "whatsapp_business_management"], targets: [F.WABA_B], exp: 0 },
    [F.TOK_B]: { app: F.APP_B, scopes: ["whatsapp_business_messaging", "whatsapp_business_management"], targets: [F.WABA_B], exp: 0 },
  } as Record<string, any>,
  wabas: {
    [F.WABA_A]: { phones: [F.PHONE_A], subscribed: {} as Record<string, { override?: string; verify_token?: string }> },
    [F.WABA_B]: { phones: [F.PHONE_B], subscribed: {} as Record<string, { override?: string; verify_token?: string }> },
  } as Record<string, any>,
  phones: {
    [F.PHONE_A]: { waba: F.WABA_A, display: "+56 9 5555 0001", name: "Clínica Sonrisa", override: null as string | null },
    [F.PHONE_B]: { waba: F.WABA_B, display: "+56 9 5555 0002", name: "Dental Norte", override: null as string | null },
  } as Record<string, any>,
  sent: [] as any[],
  verifications: [] as any[],
};

const err = (code: number, message: string, status = 400) => ({ status, body: { error: { message, type: "OAuthException", code, fbtrace_id: "fake" } } });
const toLocal = (u: string) => u.replace(PUBLIC_BASE, LOCAL_BASE);

async function verifyCallback(url: string, token: string) {
  const challenge = randomBytes(6).toString("hex");
  const q = new URL(toLocal(url));
  q.searchParams.set("hub.mode", "subscribe");
  q.searchParams.set("hub.verify_token", token);
  q.searchParams.set("hub.challenge", challenge);
  try {
    const r = await fetch(q);
    const text = await r.text();
    const ok = r.status === 200 && text === challenge;
    state.verifications.push({ url, ok, status: r.status });
    return ok;
  } catch (e: any) {
    state.verifications.push({ url, ok: false, error: e.message });
    return false;
  }
}

function effectiveRoute(phoneId: string) {
  const p = state.phones[phoneId];
  const w = state.wabas[p.waba];
  const [appId, sub] = Object.entries(w.subscribed)[0] ?? [];
  const appCb = appId ? state.apps[appId as string].subscriptions.whatsapp_business_account?.callback_url : undefined;
  return { appId: appId as string | undefined, url: p.override || (sub as any)?.override || appCb || null, cfg: { phone_number: p.override || undefined, whatsapp_business_account: (sub as any)?.override, application: appCb } };
}

function tokenFor(req: http.IncomingMessage, url: URL, form?: URLSearchParams) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("access_token") || form?.get("access_token") || "";
}
const appToken = (t: string) => { const [id, s] = t.split("|"); return state.apps[id]?.secret === s ? id : null; };
const canWaba = (t: string, waba: string) => { const k = state.tokens[t]; return k && k.targets.includes(waba) && (k.exp === 0 || k.exp > Date.now() / 1000); };

async function readBody(req: http.IncomingMessage) { let s = ""; for await (const c of req) s += c; return s; }

async function handle(req: http.IncomingMessage, url: URL): Promise<{ status: number; body: any }> {
  const parts = url.pathname.split("/").filter(Boolean);
  // control
  if (parts[0] === "__state") return { status: 200, body: state };
  if (parts[0] === "__route") return { status: 200, body: effectiveRoute(url.searchParams.get("phone")!) };
  if (parts[0] === "__deliver") {
    const b = JSON.parse(await readBody(req));
    const route = effectiveRoute(b.phone);
    if (!route.url) return { status: 200, body: { delivered: false, reason: "sin ruta" } };
    const p = state.phones[b.phone];
    const payload = b.payload ?? {
      object: "whatsapp_business_account",
      entry: [{ id: p.waba, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: p.display.replace(/\D/g, ""), phone_number_id: b.phone },
        contacts: [{ profile: { name: b.name || "Paciente Prueba" }, wa_id: b.from }],
        messages: [{ from: b.from, id: "wamid.IN" + randomBytes(5).toString("hex"), timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: b.text } }] } }] }],
    };
    const raw = JSON.stringify(payload);
    const secret = b.secret ?? state.apps[route.appId!].secret;
    const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const r = await fetch(toLocal(route.url), { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": b.badSig ? "sha256=" + "0".repeat(64) : sig }, body: raw });
    return { status: 200, body: { delivered: true, to: route.url, status: r.status } };
  }

  if (parts[0] !== "v22.0") return err(100, "unknown version", 404);
  const [id, edge] = parts.slice(1);
  const raw = req.method === "POST" ? await readBody(req) : "";
  const isForm = String(req.headers["content-type"] || "").includes("urlencoded");
  const form = isForm ? new URLSearchParams(raw) : undefined;
  const json = !isForm && raw ? JSON.parse(raw) : {};
  const tok = tokenFor(req, url, form);

  if (id === "debug_token") {
    if (!appToken(tok)) return err(1, "Error validating client secret.");
    const t = state.tokens[url.searchParams.get("input_token") || ""];
    if (!t) return { status: 200, body: { data: { is_valid: false, error: { code: 190, message: "Invalid OAuth access token." } } } };
    return { status: 200, body: { data: { app_id: t.app, type: "SYSTEM_USER", application: state.apps[t.app].name, expires_at: t.exp, is_valid: true, scopes: t.scopes,
      granular_scopes: t.scopes.map((s: string) => ({ scope: s, target_ids: t.targets })) } } };
  }

  // App subscriptions (token de app)
  if (state.apps[id] && edge === "subscriptions") {
    if (appToken(tok) !== id) return err(190, "Invalid OAuth access token - Cannot parse access token");
    const app = state.apps[id];
    if (req.method === "GET") return { status: 200, body: { data: Object.entries(app.subscriptions).map(([object, s]: any) => ({ object, callback_url: s.callback_url, active: s.active, fields: s.fields.map((n: string) => ({ name: n, version: "v22.0" })) })) } };
    const object = form!.get("object")!, cb = form!.get("callback_url")!, vt = form!.get("verify_token")!;
    if (!(await verifyCallback(cb, vt))) return err(2200, "(#2200) Callback verification failed with the following errors: HTTP Status Code = 403");
    app.subscriptions[object] = { callback_url: cb, fields: form!.get("fields")!.split(","), verify_token: vt, active: true };
    return { status: 200, body: { success: true } };
  }

  // WABA
  if (state.wabas[id]) {
    const w = state.wabas[id];
    if (!canWaba(tok, id)) return err(200, "(#200) Permissions error");
    if (edge === "phone_numbers") return { status: 200, body: { data: w.phones.map((p: string) => ({ id: p, display_phone_number: state.phones[p].display })) } };
    if (edge === "message_templates") return { status: 200, body: { data: [{ name: "hello_world", status: "APPROVED", language: "en_US", category: "UTILITY" }] } };
    if (edge === "subscribed_apps") {
      const t = state.tokens[tok];
      if (!t.scopes.includes("whatsapp_business_management")) return err(200, "(#200) Requires whatsapp_business_management permission");
      if (req.method === "GET") return { status: 200, body: { data: Object.entries(w.subscribed).map(([a, s]: any) => ({ whatsapp_business_api_data: { id: a, name: state.apps[a].name }, override_callback_uri: s.override })) } };
      if (json.override_callback_uri) {
        if (!json.verify_token) return err(100, "(#100) verify_token is required");
        if (!(await verifyCallback(json.override_callback_uri, json.verify_token))) return err(2200, "(#2200) Callback verification failed with the following errors: HTTP Status Code = 403");
        w.subscribed[t.app] = { override: json.override_callback_uri, verify_token: json.verify_token };
      } else w.subscribed[t.app] = {};
      return { status: 200, body: { success: true } };
    }
  }

  // Número
  if (state.phones[id]) {
    const p = state.phones[id];
    if (!canWaba(tok, p.waba)) return err(100, `Unsupported get request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`);
    if (edge === "messages") {
      if (json.status === "read") return { status: 200, body: { success: true } };
      state.sent.push({ phone: id, ...json });
      return { status: 200, body: { messaging_product: "whatsapp", messages: [{ id: "wamid.OUT" + randomBytes(5).toString("hex") }] } };
    }
    if (req.method === "POST" && json.webhook_configuration) {
      const c = json.webhook_configuration;
      if (c.override_callback_uri === "") { p.override = null; return { status: 200, body: { success: true } }; }
      if (!(await verifyCallback(c.override_callback_uri, c.verify_token))) return err(2200, "(#2200) Callback verification failed");
      p.override = c.override_callback_uri;
      return { status: 200, body: { success: true } };
    }
    if ((url.searchParams.get("fields") || "").includes("webhook_configuration")) return { status: 200, body: { id, webhook_configuration: effectiveRoute(id).cfg } };
    return { status: 200, body: { id, display_phone_number: p.display, verified_name: p.name, quality_rating: "GREEN" } };
  }
  return err(100, `Unsupported request. Object with ID '${id}' does not exist.`);
}

if (process.argv[1]?.endsWith("fakeMeta.ts")) {
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);
      try {
        const r = await handle(req, url);
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.body));
      } catch (e: any) {
        res.writeHead(500); res.end(JSON.stringify({ error: { message: e.message } }));
      }
    })
    .listen(PORT, () => console.log(`fake meta en http://127.0.0.1:${PORT}`));
}
