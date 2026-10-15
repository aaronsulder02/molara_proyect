// E2E con navegador real: Ajustes (link de reseñas) → reserva en /reservar → mensaje prellenado de WhatsApp
// entregado al webhook firmado (Meta simulado) → el bot verifica la reserva y envía la reseña.
// Requiere el mismo entorno que metaConnect.e2e.ts (fakeSupabase, fakeMeta y `next start -p 3100`).
import assert from "node:assert/strict";
import { chromium } from "playwright";
import pg from "pg";
import { F } from "./fakeMeta";

const APP = "http://localhost:3100";
const META = "http://127.0.0.1:5555";
const pool = new pg.Pool({ connectionString: "postgresql://postgres@127.0.0.1/molara_e2e" });
const meta = async (p: string, body?: any) => (await fetch(META + p, body ? { method: "POST", body: JSON.stringify(body) } : {})).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (m: string) => console.log("✔", m);
const REVIEW = "https://g.page/r/MOLARA-DEMO/review";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  try {
    await pool.query("delete from whatsapp_accounts where phone_number_id=$1", [F.PHONE_A]); // libera el número de prueba
    // 1) Registro + conexión de WhatsApp (número de prueba A)
    await page.goto(APP + "/registro");
    await page.fill("[name=clinic]", "Dr Gregorio Web");
    await page.fill("[name=name]", "Dr. Gregorio");
    await page.fill("[name=email]", `web.${Date.now()}@test.cl`);
    await page.fill("[name=password]", "Molara2026!");
    if (await page.$("[name=phone]")) await page.fill("[name=phone]", "+56911112222");
    if (await page.$("[name=city]")) await page.fill("[name=city]", "Santiago");
    await Promise.all([page.waitForURL(/\/panel/, { timeout: 30000 }), page.click("button[type=submit]")]);
    await page.goto(APP + "/panel/whatsapp");
    await page.fill("[name=phone_number_id]", F.PHONE_A);
    await page.fill("[name=waba_id]", F.WABA_A);
    await page.fill("[name=app_id]", F.APP_A);
    await page.fill("[name=app_secret]", F.SECRET_A);
    await page.fill("[name=access_token]", F.TOK_PERM);
    const form = page.locator("form", { has: page.locator("[name=app_id]") });
    await form.locator("button[type=submit]").click();
    await form.locator(".alert-ok").first().waitFor({ timeout: 30000 });
    const { rows: [acc] } = await pool.query("select * from whatsapp_accounts where phone_number_id=$1", [F.PHONE_A]);
    const clinicId = acc.clinic_id;
    ok("Consultorio registrado y WhatsApp conectado");

    // 2) Ajustes: link de reseñas (validación + guardado)
    await page.goto(APP + "/panel/ajustes");
    const clinicForm = page.locator("form", { has: page.locator("[name=google_review_url]") });
    await page.fill("[name=google_review_url]", REVIEW);
    await clinicForm.locator("button[type=submit]").click();
    await clinicForm.locator(".alert-ok").first().waitFor({ timeout: 15000 });
    const { rows: [cl] } = await pool.query("select slug, google_review_url, timezone from clinics where id=$1", [clinicId]);
    assert.equal(cl.google_review_url, REVIEW);
    ok("Ajustes → «Link para reseñas en Google» guardado");

    // Agenda: un servicio y horario todos los días (por si el registro no los crea)
    const { rows: [svc] } = await pool.query(`insert into services(clinic_id, name, duration_min, price, sort) values ($1,'Evaluación odontológica',30,15000,0) returning id`, [clinicId]);
    const { rows: [den] } = await pool.query(`insert into dentists(clinic_id, name) values ($1,'Dr. Gregorio Paz') returning id`, [clinicId]);
    for (let wd = 0; wd < 7; wd++) await pool.query(`insert into schedules(clinic_id, dentist_id, weekday, start_time, end_time) values ($1,$2,$3,'09:00','18:00')`, [clinicId, den.id, wd]);
    await pool.query(`update services set active=false where clinic_id=$1 and id<>$2`, [clinicId, svc.id]).catch(() => null);

    // 3) Reserva en la página pública
    await page.goto(`${APP}/reservar/${cl.slug}`);
    await page.getByText("Evaluación odontológica").first().click();
    await page.locator(".day-btn").nth(1).click();
    await page.locator(".slot-btn").first().waitFor();
    await page.locator(".slot-btn").first().click();
    await page.getByRole("button", { name: /Continuar/ }).click();
    await page.getByLabel("Nombre y apellido").fill("Salomon Carrillo");
    await page.getByLabel("Celular (WhatsApp)").fill("+56 9 1234 9423");
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    const wa = page.locator("a.btn-wa", { hasText: "Recibir confirmación por WhatsApp" });
    await wa.waitFor({ timeout: 15000 });
    const href = await wa.getAttribute("href");
    const text = new URL(href!).searchParams.get("text")!;
    const { rows: [appt] } = await pool.query(`select a.id from appointments a join patients p on p.id=a.patient_id where a.clinic_id=$1 and p.full_name='Salomon Carrillo'`, [clinicId]);
    assert.match(text, /^Hola, acabo de reservar Evaluación odontológica para el .+ hrs\. Mi nombre es Salomon Carrillo\. Código de reserva: [0-9A-F]{6}$/);
    assert.ok(appt.id.toUpperCase().startsWith(text.slice(-6)), "el código corresponde a la cita");
    ok(`Página de reserva → link de WhatsApp con código: «${text}»`);

    // 4) El paciente envía ese texto por WhatsApp (webhook firmado por Meta simulado)
    const before = (await meta("/__state")).sent.length;
    const d = await meta("/__deliver", { phone: F.PHONE_A, from: "56912349423", text, name: "Salomon" });
    assert.equal(d.status, 200, "webhook acepta la firma");
    let out: any[] = [];
    for (let i = 0; i < 40 && out.length < 2; i++) { await sleep(250); out = (await meta("/__state")).sent.slice(before); }
    const body = (p: any) => p.interactive?.body?.text ?? p.text?.body ?? "";
    assert.equal(out[0].interactive.header.text, "Reserva verificada", body(out[0]));
    assert.ok(!/no hay horarios/i.test(body(out[0])));
    assert.match(body(out[0]), /Salomon/); assert.match(body(out[0]), /Evaluación odontológica/);
    assert.equal(out[1].interactive.type, "cta_url"); assert.equal(out[1].interactive.action.parameters.url, REVIEW);
    ok("Webhook real → «Reserva verificada» con botones Confirmo/Reagendar/Cancelar + «Dejar reseña»");
    console.log("\nFlujo web → WhatsApp con navegador: OK");
  } catch (e) {
    console.error("✘ FALLÓ:", e);
    await page.screenshot({ path: process.env.SHOT || "/tmp/webBooking-fail.png", fullPage: true }).catch(() => null);
    process.exitCode = 1;
  } finally {
    await browser.close(); await pool.end();
  }
})();
