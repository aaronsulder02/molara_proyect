import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicHttps, configureWebhook, webhookUrlFor, newVerifyToken, friendly } from "../lib/metaConnect";

test("detecta URLs públicas https", () => {
  assert.equal(isPublicHttps("https://molara-theta.vercel.app"), true);
  assert.equal(isPublicHttps("https://midominio.cl"), true);
  for (const u of ["http://localhost:3000", "https://localhost:3000", "http://molara.cl", "https://127.0.0.1", "https://192.168.1.5", "https://10.0.0.2", "", "no-url"]) assert.equal(isPublicHttps(u), false, u);
});

test("en local el webhook queda pendiente sin llamar a Meta", async () => {
  const called: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (u: any) => { called.push(String(u)); throw new Error("no debe llamar"); }) as any;
  try {
    const r = await configureWebhook({ phoneNumberId: "1", wabaId: "2", token: "t", appId: "3", appSecret: "s", verifyToken: "v", clinicId: "c" }, "http://localhost:3000");
    assert.equal(r.status, "pending");
    assert.equal(r.steps[0].state, "skip");
    assert.equal(called.length, 0);
  } finally { globalThis.fetch = orig; }
});

test("URL del webhook y token de verificación", () => {
  assert.equal(webhookUrlFor("https://x.cl"), "https://x.cl/api/whatsapp/webhook");
  const a = newVerifyToken(), b = newVerifyToken();
  assert.match(a, /^molara_[0-9a-f]{48}$/); assert.notEqual(a, b);
});

test("errores de Meta traducidos", () => {
  assert.match(friendly({ ok: false, status: 400, json: null, error: "Error validating client secret.", code: 1 }, "app"), /App Secret no son correctos/);
  assert.match(friendly({ ok: false, status: 400, json: null, error: "Session has expired", code: 190 }, "token"), /expiró/);
  assert.match(friendly({ ok: false, status: 403, json: null, error: "(#200) Permissions error", code: 200 }, "waba"), /permisos/);
});
