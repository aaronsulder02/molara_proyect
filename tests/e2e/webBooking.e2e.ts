// E2E: reserva hecha en la agenda web → el paciente escribe por WhatsApp el mensaje prellenado.
// El bot debe VERIFICAR la cita existente (nombre/código/celular), nunca responder "no hay horarios",
// manejar un celular distinto al del chat y, al terminar, invitar a seguir el Instagram (con beneficio).
// La reseña en Google se pide el DÍA SIGUIENTE a la cita (cron).
import assert from "node:assert/strict";
import { fakeDb } from "./fakeDb";
import { __setDbForTests } from "../../lib/supabase";
import { handleInbound, sendReviewRequestsForClinic, cleanHandle } from "../../lib/bot";
import { bookAppointment } from "../../lib/booking";
import { getSlots } from "../../lib/availability";
import { addDaysYmd, ymdInTz, weekdayOfYmd } from "../../lib/time.ts";

const DB = fakeDb("postgresql://postgres@127.0.0.1/molara_e2e");
__setDbForTests(DB);
const pool = DB.pool;

/* ── Meta y AI Gateway simulados ─────────────────────────────────── */
const sent: any[] = [];
const aiCalls: any[] = [];
let aiScript: any[] = [];
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (u.includes("graph.facebook.com")) {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (body.status === "read") return new Response(JSON.stringify({ success: true }));
    sent.push(body);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.o" + Math.random().toString(36).slice(2) }] }));
  }
  if (u.includes("ai-gateway.vercel.sh")) {
    const b = JSON.parse(init.body);
    aiCalls.push(b);
    if (b.response_format?.type === "json_object") return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    return new Response(JSON.stringify({ choices: [{ message: aiScript.shift() ?? { role: "assistant", content: "" } }] }));
  }
  throw new Error("fetch no simulado: " + u);
}) as any;

function validate(p: any) {
  if (p.type === "text") return assert.ok(p.text.body.length <= 4096);
  const i = p.interactive;
  if (i.header) assert.ok(i.header.text.length <= 60);
  if (i.footer) assert.ok(i.footer.text.length <= 60);
  assert.ok(i.body.text.length <= 1024, "cuerpo interactivo ≤1024");
  if (i.type === "button") { assert.ok(i.action.buttons.length <= 3); for (const b of i.action.buttons) assert.ok(b.reply.title.length <= 20, `botón ≤20: ${b.reply.title}`); }
  if (i.type === "list") for (const r of i.action.sections.flatMap((s: any) => s.rows)) assert.ok(r.title.length <= 24);
  if (i.type === "cta_url") assert.ok(i.action.parameters.display_text.length <= 20);
}
let n = 0;
const acc: any = { clinic_id: "", phone_number_id: "999000333", waba_id: "888", access_token: "tok" };
const txt = (from: string, body: string) => ({ from, id: `wamid.w${++n}`, type: "text", text: { body } });
const btn = (from: string, id: string) => ({ from, id: `wamid.w${++n}`, type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: id } } });
async function say(msg: any) {
  const before = sent.length;
  await handleInbound(acc, msg, { wa_id: msg.from, profile: { name: "Paciente" } });
  const out = sent.slice(before);
  out.forEach(validate);
  for (const o of out) assert.ok(!/no hay horarios|no me queda/i.test(bodyOf(o)), `no debe decir que el horario está ocupado: ${bodyOf(o)}`);
  return out;
}
const bodyOf = (p: any) => (p.type === "text" ? p.text.body : p.interactive.body.text);
const ids = (p: any) => (p.interactive?.action?.buttons ?? []).map((b: any) => b.reply.id);
const ok = (m: string) => console.log("✔", m);

/** Mismo formato que arma la página /reservar al terminar (BookingWizard). */
function webMessage(service: string, startISO: string, name: string, tz: string, code?: string) {
  const s = new Intl.DateTimeFormat("es-CL", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startISO));
  const when = s.charAt(0).toUpperCase() + s.slice(1) + " hrs";
  return `Hola, acabo de reservar ${service} para el ${when}. Mi nombre es ${name}.${code ? ` Código de reserva: ${code}` : ""}`;
}

async function main() {
  await pool.query("truncate clinics cascade");
  const REVIEW = "https://g.page/r/CLINICA-DEMO/review";
  const { rows: [clinic] } = await pool.query(
    `insert into clinics(name, slug, address, city, min_notice_min, ai_enabled, google_review_url, instagram_handle, instagram_perk) values ('Dr Gregorio','dr-gregorio','Av. Siempre Viva 742','Santiago',0,true,$1,'clinicadrgregorio','10% de descuento en tu próxima limpieza') returning *`, [REVIEW]);
  const IG = "https://www.instagram.com/clinicadrgregorio/";
  const isFollow = (p: any) => p?.interactive?.type === "cta_url" && p.interactive.action.parameters.url === IG;
  acc.clinic_id = clinic.id;
  const tz = clinic.timezone;
  await pool.query(`insert into whatsapp_accounts(clinic_id, phone_number_id, waba_id, access_token, display_phone) values ($1,'999000333','888','tok','+56 9 3333 3333')`, [clinic.id]);
  const { rows: [g] } = await pool.query(`insert into dentists(clinic_id, name) values ($1,'Dr. Gregorio') returning id`, [clinic.id]);
  const { rows: [m] } = await pool.query(`insert into dentists(clinic_id, name) values ($1,'Dra. Magui') returning id`, [clinic.id]);
  const { rows: svcs } = await pool.query(`insert into services(clinic_id, name, duration_min, price, sort) values ($1,'Evaluación odontológica',30,15000,1),($1,'Limpieza dental',45,35000,2) returning id, name`, [clinic.id]);
  const EVAL = svcs.find((s: any) => s.name.startsWith("Evaluación"));
  const LIMP = svcs.find((s: any) => s.name.startsWith("Limpieza"));
  for (const dId of [g.id, m.id]) for (let wd = 1; wd <= 6; wd++) await pool.query(`insert into schedules(clinic_id, dentist_id, weekday, start_time, end_time) values ($1,$2,$3,'09:00','18:00')`, [clinic.id, dId, wd]);
  process.env.AI_GATEWAY_API_KEY = "test"; // IA activa: el agente NO debe intervenir en este flujo

  let day = addDaysYmd(ymdInTz(new Date(), tz), 2);
  while (weekdayOfYmd(day) === 0) day = addDaysYmd(day, 1);
  const at = async (hm: string, dentistId: string, serviceId: string) => (await getSlots(clinic, { serviceId, ymd: day, dentistId })).find((s) => s.hm === hm)!.start;
  const web = async (serviceId: string, startISO: string, dentistId: string, name: string, phone: string) => {
    const r = await bookAppointment({ clinic, serviceId, startISO, dentistId, patient: { phone, full_name: name }, channel: "web" });
    assert.ok(r.ok, r.error); return r.appointment;
  };

  /* ═══ 1) Caso del reporte: reserva web con el MISMO celular del chat ═══ */
  const SALOMON = "56912349423";
  const s10 = await at("10:00", g.id, EVAL.id);
  const a1 = await web(EVAL.id, s10, g.id, "Salomon Carrillo", "+56 9 1234 9423");
  aiCalls.length = 0;
  let out = await say(txt(SALOMON, webMessage(EVAL.name, s10, "Salomon Carrillo", tz)));
  assert.equal(aiCalls.filter((b) => b.tools).length, 0, "el agente no consulta disponibilidad");
  assert.equal(out[0].interactive.header.text, "Reserva verificada");
  assert.match(bodyOf(out[0]), /Salomon/); assert.match(bodyOf(out[0]), /Evaluación odontológica/); assert.match(bodyOf(out[0]), /10:00/); assert.match(bodyOf(out[0]), /Dr\. Gregorio/);
  assert.deepEqual(ids(out[0]), [`aok:${a1.id}`, `arb:${a1.id}`, `acx:${a1.id}`]);
  assert.ok(isFollow(out[1]), "invita a seguir el Instagram");
  assert.match(bodyOf(out[1]), /regalo antes de irte, Salomon/); assert.match(bodyOf(out[1]), /10% de descuento en tu próxima limpieza/);
  assert.equal(out[1].interactive.action.parameters.display_text, "Seguir y ganar 🎁"); assert.equal(out[1].interactive.footer.text, "@clinicadrgregorio");
  assert.ok(!out.some((o) => o.interactive?.action?.parameters?.url === REVIEW), "la reseña ya no se pide al reservar");
  ok("Mensaje prellenado de la web → «Reserva verificada» + invitación a Instagram con beneficio (sin reseña todavía)");

  out = await say(btn(SALOMON, `aok:${a1.id}`));
  assert.match(bodyOf(out[0]), /Gracias por confirmar/);
  const { rows: [c1] } = await pool.query(`select status from appointments where id=$1`, [a1.id]);
  assert.equal(c1.status, "confirmed");
  ok("Botón «Confirmo» → cita confirmada");

  /* ═══ 2) Celular del formulario distinto al del chat (caso Nancy) ═══ */
  const CHAT = "56955559423";
  const s10b = await at("10:00", m.id, LIMP.id);
  const a2 = await web(LIMP.id, s10b, m.id, "Nancy Menes", "+56 9 8765 5655");
  out = await say(txt(CHAT, webMessage(LIMP.name, s10b, "Nancy Menes", tz)));
  assert.equal(out.length, 1);
  assert.match(bodyOf(out[0]), /terminado en \*5655\*/); assert.ok(!/87655655/.test(bodyOf(out[0])), "no muestra el número completo");
  assert.deepEqual(ids(out[0]), [`wlink:${a2.id}`, `wkeep:${a2.id}`]);
  ok("Celular distinto → avisa (solo últimos 4 dígitos) y pregunta si mover los avisos a este WhatsApp");

  out = await say(btn(CHAT, `wlink:${a2.id}`));
  assert.match(bodyOf(out[0]), /avisos de esta cita llegarán a este WhatsApp/); assert.match(bodyOf(out[0]), /Nancy/);
  const { rows: [c2] } = await pool.query(`select p.phone, p.full_name from appointments a join patients p on p.id=a.patient_id where a.id=$1`, [a2.id]);
  assert.equal(c2.phone, CHAT); assert.equal(c2.full_name, "Nancy Menes");
  assert.ok(isFollow(out[1]));
  ok("«Sí, a este número» → la cita pasa al celular del chat (recordatorios llegan aquí) + Instagram");

  out = await say(btn(CHAT, `wlink:${a2.id}`));
  assert.ok(!bodyOf(out[0]).includes("avisos de esta cita"), "botón viejo no vuelve a reasignar");
  ok("Botón viejo de vinculación ya no actúa (se exige haber identificado la reserva antes)");

  /* ═══ 3) «No, dejarlo así» ═══ */
  const OTHER = "56944440000";
  const s11 = await at("11:00", g.id, EVAL.id);
  const a3 = await web(EVAL.id, s11, g.id, "Pedro Soto", "+56 9 1111 2222");
  await say(txt(OTHER, webMessage(EVAL.name, s11, "Pedro Soto", tz)));
  out = await say(btn(OTHER, `wkeep:${a3.id}`));
  assert.match(bodyOf(out[0]), /queda tal cual/);
  const { rows: [c3] } = await pool.query(`select p.phone from appointments a join patients p on p.id=a.patient_id where a.id=$1`, [a3.id]);
  assert.equal(c3.phone, "56911112222");
  ok("«No, dejarlo así» → la cita conserva el celular del formulario");

  /* ═══ 4) Sin coincidencia de identidad → no se revela la cita de otra persona ═══ */
  const STRANGER = "56933330000";
  out = await say(txt(STRANGER, webMessage(EVAL.name, s11, "Juan Pérez", tz)));
  assert.match(bodyOf(out[0]), /No encontré una reserva a nombre de \*Juan Pérez\*/);
  assert.ok(!/Pedro/.test(bodyOf(out[0])));
  ok("Nombre que no coincide → «No encontré una reserva», sin mostrar datos ajenos");

  /* ═══ 5) Código de reserva (nombre mal escrito) ═══ */
  const ANA = "56977778888";
  const s12 = await at("12:00", g.id, EVAL.id);
  const a5 = await web(EVAL.id, s12, g.id, "Ana María Lagos", "+56 9 7777 8888");
  out = await say(txt(ANA, webMessage(EVAL.name, s12, "Anita", tz, a5.id.slice(0, 6).toUpperCase())));
  assert.equal(out[0].interactive.header.text, "Reserva verificada"); assert.ok(ids(out[0]).includes(`aok:${a5.id}`));
  ok("Código de reserva identifica la cita aunque el nombre no coincida exacto");

  /* ═══ 6) Instagram: máximo una vez cada 90 días por paciente ═══ */
  out = await say(txt(SALOMON, webMessage(EVAL.name, s10, "Salomon Carrillo", tz)));
  assert.equal(out.length, 1, "segunda verificación sin repetir la invitación");
  ok("No se repite la invitación a Instagram al mismo paciente");

  /* ═══ 7) Mismo paciente no puede tener dos horas que se crucen (otro profesional) ═══ */
  const s16 = await at("16:00", g.id, EVAL.id);
  await web(EVAL.id, s16, g.id, "Salomon Carrillo", SALOMON);
  const dup = await bookAppointment({ clinic, serviceId: LIMP.id, startISO: await at("16:00", m.id, LIMP.id), dentistId: m.id, patient: { phone: SALOMON, full_name: "Salomon Carrillo" }, channel: "web" });
  assert.equal(dup.ok, false); assert.match(dup.error!, /Ya tienes una hora/);
  ok("Doble reserva del mismo paciente a la misma hora con otro profesional → bloqueada");

  /* ═══ 8) Reserva completa por WhatsApp → al final invita a la reseña ═══ */
  const NEW = "56966665555";
  await pool.query(`insert into patients(clinic_id, phone, full_name) values ($1,$2,'Rosa Díaz')`, [clinic.id, NEW]);
  const s14 = await at("14:00", g.id, EVAL.id);
  await pool.query(`insert into conversations(clinic_id, wa_id, state) values ($1,$2,$3)`, [clinic.id, NEW, JSON.stringify({ serviceId: EVAL.id, pending: { dentistId: g.id, start: s14 }, step: "confirm" })]);
  out = await say(btn(NEW, "ok"));
  assert.match(bodyOf(out[0]), /agendada/); assert.ok(isFollow(out[1]));
  ok("Reserva hecha por WhatsApp → cita agendada + invitación a Instagram");

  /* ═══ 9) Sin Instagram configurado → solo la verificación ═══ */
  await pool.query(`update clinics set instagram_handle=null where id=$1`, [clinic.id]);
  const LUIS = "56922221111";
  const s15 = await at("15:00", g.id, EVAL.id);
  await web(EVAL.id, s15, g.id, "Luis Mena", "+56 9 2222 1111");
  out = await say(txt(LUIS, webMessage(EVAL.name, s15, "Luis Mena", tz)));
  assert.equal(out.length, 1);
  ok("Consultorio sin Instagram → solo la verificación");

  /* ═══ 10) El agente IA conoce las citas del paciente ═══ */
  aiCalls.length = 0;
  aiScript = [{ role: "assistant", content: "Tu cita es el día indicado 🙂" }];
  await say(txt(LUIS, "a qué hora era mi cita?"));
  const sys = aiCalls.find((b) => b.tools)?.messages?.[0]?.content as string;
  assert.match(sys, /Próximas citas de este paciente: Evaluación odontológica con Dr\. Gregorio/);
  assert.match(sys, /YA reservó/);
  ok("Contexto del agente incluye las próximas citas del paciente y la regla de reservas existentes");

  /* ═══ 11) Instagram conectado en el panel y sin beneficio → texto de exclusividad ═══ */
  await pool.query(`insert into instagram_accounts(clinic_id, ig_user_id, access_token, username) values ($1,'17841','tok','dr.gregorio.dental')`, [clinic.id]);
  const s0930 = await at("09:30", g.id, EVAL.id);
  const SOFIA = "56988887777";
  await web(EVAL.id, s0930, g.id, "Sofía Lagos", SOFIA);
  await pool.query(`update clinics set instagram_perk=null where id=$1`, [clinic.id]);
  out = await say(txt(SOFIA, webMessage(EVAL.name, s0930, "Sofía Lagos", tz)));
  assert.equal(out[1].interactive.action.parameters.url, "https://www.instagram.com/dr.gregorio.dental/");
  assert.match(bodyOf(out[1]), /Ya nos sigues, Sofía/); assert.match(bodyOf(out[1]), /promociones exclusivas para seguidores/);
  assert.equal(out[1].interactive.action.parameters.display_text, "Seguir en Instagram");
  ok("Sin beneficio → «¿Ya nos sigues?» con la cuenta conectada en Instagram");
  assert.equal(cleanHandle("https://www.instagram.com/Clinica_Sonrie/?hl=es"), "Clinica_Sonrie"); assert.equal(cleanHandle("@dr.paz"), "dr.paz"); assert.equal(cleanHandle("no válido!"), null);
  ok("Usuario de Instagram aceptado como @usuario o link del perfil");

  /* ═══ 12) Cron: reseña en Google el día siguiente a la cita ═══ */
  await pool.query(`update clinics set google_review_url=$2 where id=$1`, [clinic.id, REVIEW]);
  const { rows: [cl2] } = await pool.query(`select * from clinics where id=$1`, [clinic.id]);
  const yday = addDaysYmd(ymdInTz(new Date(), tz), -1);
  const past = async (phone: string, name: string, hm: string, status = "confirmed", dentistId = g.id) => {
    const { rows: [p] } = await pool.query(`insert into patients(clinic_id, phone, full_name) values ($1,$2,$3) on conflict (clinic_id, phone) do update set full_name=excluded.full_name returning id`, [clinic.id, phone, name]);
    const { rows: [a] } = await pool.query(`insert into appointments(clinic_id, patient_id, dentist_id, service_id, starts_at, ends_at, status, channel) values ($1,$2,$3,$4,($5::date + $6::time) at time zone $7, ($5::date + $6::time + interval '30 min') at time zone $7, $8, 'web') returning id`, [clinic.id, p.id, dentistId, EVAL.id, yday, hm, tz, status]);
    return a.id;
  };
  const R1 = "56910101010", R2 = "56920202020", R3 = "56930303030";
  const r1 = await past(R1, "Marta Ríos", "10:00");                     // escribió hace poco → ventana abierta
  await pool.query(`insert into conversations(clinic_id, wa_id, last_inbound_at) values ($1,$2, now() - interval '3 hours')`, [clinic.id, R1]);
  await past(R2, "Hugo Vera", "11:00");                                  // sin ventana y sin plantilla → se omite
  await past(R3, "Inés Toro", "12:00", "cancelled");                      // cancelada → nunca
  const before = sent.length;
  let rv = await sendReviewRequestsForClinic(cl2, acc);
  const msgs = sent.slice(before);
  assert.deepEqual({ sent: rv.sent, skipped: rv.skipped }, { sent: 1, skipped: 1 });
  assert.equal(msgs[0].to, R1); assert.equal(msgs[0].interactive.action.parameters.url, REVIEW);
  assert.match(bodyOf(msgs[0]), /Hola Marta/); assert.match(bodyOf(msgs[0]), /felicitarte por tu \*Evaluación odontológica\*/); assert.match(bodyOf(msgs[0]), /\*Dr Gregorio\*/);
  const { rows: [rr] } = await pool.query(`select review_requested_at from appointments where id=$1`, [r1]);
  assert.ok(rr.review_requested_at);
  ok("Día siguiente: reseña con botón a quien tiene la ventana de 24 h abierta; cancelada excluida");

  rv = await sendReviewRequestsForClinic(cl2, acc);
  assert.equal(rv.sent, 0, "no se repite");
  await pool.query(`update clinics set review_template='resena_google' where id=$1`, [clinic.id]);
  const { rows: [cl3] } = await pool.query(`select * from clinics where id=$1`, [clinic.id]);
  const b2 = sent.length;
  rv = await sendReviewRequestsForClinic(cl3, acc);
  const tpl = sent.slice(b2)[0];
  assert.equal(rv.sent, 1); assert.equal(tpl.to, R2); assert.equal(tpl.type, "template"); assert.equal(tpl.template.name, "resena_google");
  assert.deepEqual(tpl.template.components[0].parameters.map((x: any) => x.text), ["Hugo", "Evaluación odontológica", "Dr Gregorio"]);
  ok("Fuera de la ventana de 24 h → usa la plantilla aprobada; nunca repite al mismo paciente");

  console.log(`\nReservas web ↔ WhatsApp: todos los escenarios OK · ${sent.length} mensajes validados contra los límites de Meta.`);
  await pool.end();
}

main().catch(async (e) => { console.error("✘ FALLÓ:", e); await pool.end(); process.exit(1); });
