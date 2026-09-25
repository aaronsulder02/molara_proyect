// E2E: conexión automática con Meta desde el panel (navegador real + Meta simulado + Postgres real).
// Requiere: fakeSupabase (54321), fakeMeta (5555, LOCAL_BASE=http://127.0.0.1:3100) y `next start -p 3100`
// construido con NEXT_PUBLIC_APP_URL=https://molara.test y META_GRAPH_URL=http://127.0.0.1:5555.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chromium, type Page } from "playwright";
import pg from "pg";
import { F } from "./fakeMeta";

const APP = "http://localhost:3100";
const META = "http://127.0.0.1:5555";
const pool = new pg.Pool({ connectionString: "postgresql://postgres@127.0.0.1/molara_e2e" });
const results: [string, boolean, string?][] = [];
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push([name, true]); console.log("✔", name); }
  catch (e: any) { results.push([name, false, e.message]); console.log("✘", name, "\n   ", e.message); }
}
const meta = async (p: string, body?: any) => (await fetch(META + p, body ? { method: "POST", body: JSON.stringify(body) } : {})).json();
const acc = async (phone: string) => (await pool.query("select * from whatsapp_accounts where phone_number_id=$1", [phone])).rows[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function register(page: Page, n: number) {
  const email = `meta${n}.${Date.now()}@test.cl`;
  await page.goto(APP + "/registro");
  await page.fill('[name=clinic]', n === 1 ? "Clínica Sonrisa" : "Dental Norte");
  await page.fill('[name=name]', "Dra. Prueba");
  await page.fill('[name=email]', email);
  await page.fill('[name=password]', "Molara2026!");
  if (await page.$('[name=phone]')) await page.fill('[name=phone]', "+56911112222");
  if (await page.$('[name=city]')) await page.fill('[name=city]', "Santiago");
  await Promise.all([page.waitForURL(/\/panel/, { timeout: 30000 }), page.click('button[type=submit]')]);
}

async function connect(page: Page, f: { phone: string; waba: string; appId: string; secret: string; token: string }) {
  await page.goto(APP + "/panel/whatsapp");
  await page.fill('[name=phone_number_id]', f.phone);
  await page.fill('[name=waba_id]', f.waba);
  await page.fill('[name=app_id]', f.appId);
  await page.fill('[name=app_secret]', f.secret);
  await page.fill('[name=access_token]', f.token);
  const form = page.locator("form", { has: page.locator('[name=app_id]') });
  await form.locator('button[type=submit]').click();
  const alert = form.locator(".alert").first();
  await alert.waitFor({ timeout: 30000 });
  return { cls: (await alert.getAttribute("class")) || "", text: (await alert.innerText()).trim() };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const A = { phone: F.PHONE_A, waba: F.WABA_A, appId: F.APP_A, secret: F.SECRET_A, token: F.TOK_PERM };

  await t("registro del consultorio 1", async () => { await register(page, 1); });

  await t("App Secret incorrecto → error claro, sin guardar nada", async () => {
    const r = await connect(page, { ...A, secret: "0".repeat(32) });
    assert.match(r.cls, /alert-err/); assert.match(r.text, /App ID o el App Secret no son correctos/);
    assert.equal(await acc(F.PHONE_A), undefined);
  });
  await t("App Secret con formato inválido → validación local", async () => {
    const r = await connect(page, { ...A, secret: "corto" });
    assert.match(r.text, /32 caracteres/);
  });
  await t("token sin permiso de gestión → error de permisos", async () => {
    const r = await connect(page, { ...A, token: F.TOK_NOPERM });
    assert.match(r.text, /faltan permisos: whatsapp_business_management/);
  });
  await t("token sin acceso a esa WABA → error específico", async () => {
    const r = await connect(page, { ...A, token: F.TOK_OTHERWABA });
    assert.match(r.text, /no tiene acceso a la cuenta de WhatsApp/);
  });
  await t("número que no pertenece a la WABA → error específico", async () => {
    const r = await connect(page, { ...A, phone: F.PHONE_B });
    assert.match(r.text, /no pertenece a la cuenta/);
  });
  await t("token inexistente → token inválido", async () => {
    const r = await connect(page, { ...A, token: "EAA_basura" });
    assert.match(r.text, /token de acceso no es válido|expiró/i);
  });

  await t("token temporal → conecta, activa webhook y advierte vencimiento", async () => {
    const r = await connect(page, { ...A, token: F.TOK_TEMP });
    assert.match(r.cls, /alert-ok/); assert.match(r.text, /configuró el webhook en Meta automáticamente/); assert.match(r.text, /temporal/);
    const a = await acc(F.PHONE_A);
    assert.equal(a.webhook_status, "active"); assert.ok(a.token_expires_at);
  });

  await t("token permanente → todo verde, sin avisos", async () => {
    const r = await connect(page, A);
    assert.match(r.cls, /alert-ok/); assert.doesNotMatch(r.text, /Aviso/);
    const a = await acc(F.PHONE_A);
    assert.equal(a.webhook_status, "active"); assert.equal(a.token_expires_at, null);
    assert.equal(a.app_id, F.APP_A); assert.equal(a.app_secret, F.SECRET_A);
    assert.match(a.webhook_verify_token, /^molara_[0-9a-f]{48}$/);
    assert.ok(a.webhook_verified_at, "Meta debió llamar a la verificación");
    assert.ok(a.setup_report.steps.every((s: any) => s.state === "ok"), JSON.stringify(a.setup_report.steps));
  });

  await t("Meta quedó configurado: app suscrita a messages + override hacia Molara", async () => {
    const s = await meta("/__state");
    const sub = s.apps[F.APP_A].subscriptions.whatsapp_business_account;
    assert.equal(sub.callback_url, "https://molara.test/api/whatsapp/webhook"); assert.deepEqual(sub.fields, ["messages"]);
    const w = s.wabas[F.WABA_A].subscribed[F.APP_A];
    assert.equal(w.override, "https://molara.test/api/whatsapp/webhook");
    const a = await acc(F.PHONE_A);
    assert.equal(w.verify_token, a.webhook_verify_token);
    assert.ok(s.verifications.filter((v: any) => v.ok).length >= 2);
    const route = await meta(`/__route?phone=${F.PHONE_A}`);
    assert.equal(route.url, "https://molara.test/api/whatsapp/webhook");
  });

  await t("panel muestra checklist verde y badge Webhook activo", async () => {
    await page.goto(APP + "/panel/whatsapp");
    assert.equal(await page.locator(".setup-step.s-ok").count(), 7);
    assert.ok(await page.getByText("Webhook activo").first().isVisible());
    await page.screenshot({ path: process.env.SHOT || "/tmp/whatsapp-panel.png", fullPage: true });
  });

  await t("paciente escribe → Meta entrega firmado con App Secret del cliente → bot responde", async () => {
    const before = (await meta("/__state")).sent.length;
    const d = await meta("/__deliver", { phone: F.PHONE_A, from: "56987654321", text: "Hola" });
    assert.equal(d.status, 200);
    let sent: any[] = [];
    for (let i = 0; i < 40 && sent.length === 0; i++) { await sleep(250); sent = (await meta("/__state")).sent.slice(before); }
    assert.ok(sent.length > 0, "el bot no respondió");
    assert.equal(sent[0].phone, F.PHONE_A); assert.equal(sent[0].to, "56987654321");
    const a = await acc(F.PHONE_A);
    assert.ok(a.webhook_last_event_at);
  });

  await t("firma inválida → 401", async () => {
    const d = await meta("/__deliver", { phone: F.PHONE_A, from: "56987654321", text: "x", badSig: true });
    assert.equal(d.status, 401);
  });
  await t("firma con el secret de OTRA app (otro consultorio) → 401", async () => {
    const d = await meta("/__deliver", { phone: F.PHONE_A, from: "56987654321", text: "x", secret: F.SECRET_B });
    assert.equal(d.status, 401);
  });
  await t("firma con el secret de la plataforma → aceptada", async () => {
    const d = await meta("/__deliver", { phone: F.PHONE_A, from: "56987654321", text: "menu", secret: "f".repeat(32) });
    assert.equal(d.status, 200);
  });
  await t("payload con número propio + número desconocido firmado por el consultorio → aceptado", async () => {
    await pool.query("update whatsapp_accounts set app_secret=$1 where phone_number_id=$2", [F.SECRET_A, F.PHONE_A]);
    const mk = (pid: string) => ({ field: "messages", value: { metadata: { phone_number_id: pid }, messages: [] } });
    const raw = JSON.stringify({ entry: [{ changes: [mk(F.PHONE_A), mk("123456789")] }] });
    // 123456789 no existe → solo cuenta A: válido. Luego con un número de otra clínica debe fallar (se prueba tras conectar la clínica 2)
    const r = await fetch(APP + "/api/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", F.SECRET_A).update(raw).digest("hex") } });
    assert.equal(r.status, 200);
  });

  await t("GET de verificación con el token del consultorio → challenge", async () => {
    const a = await acc(F.PHONE_A);
    const r = await fetch(`${APP}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${a.webhook_verify_token}&hub.challenge=777`);
    assert.equal(r.status, 200); assert.equal(await r.text(), "777");
  });

  await t("botón Reconfigurar webhook", async () => {
    await page.goto(APP + "/panel/whatsapp");
    const form = page.locator("form", { has: page.getByText("Reconfigurar webhook") });
    await form.locator("button").click();
    const al = form.locator(".alert").first(); await al.waitFor({ timeout: 30000 });
    assert.match(await al.innerText(), /Webhook verificado y activo/);
  });

  await t("actualizar sin reescribir secretos (campos vacíos mantienen los guardados)", async () => {
    await page.goto(APP + "/panel/whatsapp");
    const form = page.locator("form", { has: page.locator('[name=app_id]') });
    await form.locator("button[type=submit]").click();
    const al = form.locator(".alert").first(); await al.waitFor({ timeout: 30000 });
    assert.match(await al.getAttribute("class") || "", /alert-ok/, await al.innerText());
  });

  // ── Consultorio 2: app con un webhook propio (CRM) que NO debemos pisar ──
  const page2 = await (await browser.newContext()).newPage();
  await t("consultorio 2 con app que ya tiene webhook de otro CRM → se respeta y se usa ruta exclusiva", async () => {
    await register(page2, 2);
    const r = await connect(page2, { phone: F.PHONE_B, waba: F.WABA_B, appId: F.APP_B, secret: F.SECRET_B, token: F.TOK_B });
    assert.match(r.cls, /alert-ok/, r.text);
    const s = await meta("/__state");
    assert.equal(s.apps[F.APP_B].subscriptions.whatsapp_business_account.callback_url, "https://otro-crm.example/hook", "no se debe modificar el webhook del CRM");
    assert.equal(s.wabas[F.WABA_B].subscribed[F.APP_B].override, "https://molara.test/api/whatsapp/webhook");
    const b = await acc(F.PHONE_B);
    assert.equal(b.webhook_status, "active");
    assert.match(JSON.stringify(b.setup_report.steps), /se conserva su configuración/);
  });
  await t("mensajes del consultorio 2 llegan a Molara (no al CRM) y el bot responde desde su número", async () => {
    const before = (await meta("/__state")).sent.length;
    const d = await meta("/__deliver", { phone: F.PHONE_B, from: "56911110000", text: "Hola" });
    assert.equal(d.to, "https://molara.test/api/whatsapp/webhook"); assert.equal(d.status, 200);
    let sent: any[] = [];
    for (let i = 0; i < 40 && sent.length === 0; i++) { await sleep(250); sent = (await meta("/__state")).sent.slice(before); }
    assert.ok(sent.length > 0); assert.equal(sent[0].phone, F.PHONE_B);
  });
  await t("aislamiento: consultorio 1 no puede firmar eventos del número del consultorio 2", async () => {
    const mk = (pid: string) => ({ field: "messages", value: { metadata: { phone_number_id: pid }, messages: [] } });
    const raw = JSON.stringify({ entry: [{ changes: [mk(F.PHONE_A), mk(F.PHONE_B)] }] });
    const r = await fetch(APP + "/api/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", F.SECRET_A).update(raw).digest("hex") } });
    assert.equal(r.status, 401);
  });
  await t("el mismo número no se puede conectar en otro consultorio", async () => {
    const r = await connect(page2, A);
    assert.match(r.text, /ya está conectado a otro consultorio/);
  });

  await t("cron reintenta webhooks pendientes", async () => {
    await pool.query("update whatsapp_accounts set webhook_status='pending' where phone_number_id=$1", [F.PHONE_B]);
    const r = await (await fetch(APP + "/api/cron/reminders", { headers: { authorization: "Bearer cron_test" } })).json();
    assert.ok(r.webhooks.some((w: any) => w.status === "active"), JSON.stringify(r.webhooks));
    assert.equal((await acc(F.PHONE_B)).webhook_status, "active");
  });

  await t("desconectar elimina la ruta exclusiva en Meta", async () => {
    await page2.goto(APP + "/panel/whatsapp");
    page2.on("dialog", (d) => d.accept());
    await page2.getByRole("button", { name: "Desconectar" }).click();
    for (let i = 0; i < 40 && (await acc(F.PHONE_B)); i++) await sleep(250);
    assert.equal(await acc(F.PHONE_B), undefined);
    const s = await meta("/__state");
    assert.equal(s.wabas[F.WABA_B].subscribed[F.APP_B].override, undefined);
  });

  await browser.close();
  await pool.end();
  const failed = results.filter((r) => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
  process.exit(failed.length ? 1 : 0);
})();
