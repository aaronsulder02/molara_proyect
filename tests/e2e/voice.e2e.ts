// E2E: agendar por notas de voz (Postgres real + Meta y AI Gateway simulados).
// Cubre: descarga del audio desde Meta, transcripción (STT y respaldo multimodal), llenado del
// formulario en varios audios, horas no disponibles, cambios, confirmación por voz, modo IA y fallos.
import assert from "node:assert/strict";
import { fakeDb } from "./fakeDb";
import { __setDbForTests } from "../../lib/supabase";
import { handleInbound } from "../../lib/bot";
import { addDaysYmd, ymdInTz, weekdayOfYmd, longDayLabel } from "../../lib/time.ts";

const DB = fakeDb("postgresql://postgres@127.0.0.1/molara_e2e");
__setDbForTests(DB);
const pool = DB.pool;

/* ── Simulación de Meta (mensajes + media) y AI Gateway ─────────── */
const sent: any[] = [];
const transcripts = new Map<string, string>(); // mediaId → texto que "dijo" el paciente
let sttMode: "ok" | "fail" | "empty" = "ok";
let chatAudioCalls = 0;
let nluScript: any[] = []; // respuestas JSON del extractor (modo IA)
let agentScript: any[] = []; // respuestas del agente con herramientas
const log: string[] = [];
const WEEK = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  const auth = init?.headers?.Authorization || init?.headers?.authorization;
  // Meta: metadatos del media → URL firmada
  const media = u.match(/graph\.facebook\.com\/v[\d.]+\/(media_[\w-]+)$/);
  if (media) {
    assert.equal(auth, "Bearer tok", "descarga de media con el token del consultorio");
    return new Response(JSON.stringify({ url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${media[1]}`, mime_type: "audio/ogg; codecs=opus", file_size: 4096, id: media[1] }));
  }
  if (u.startsWith("https://lookaside.fbsbx.com/")) {
    assert.equal(auth, "Bearer tok");
    const id = new URL(u).searchParams.get("mid")!;
    return new Response(Buffer.from(`OggS-fake-${id}`), { headers: { "content-type": "audio/ogg" } });
  }
  if (u.includes("graph.facebook.com")) {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (body.status === "read") return new Response(JSON.stringify({ success: true }));
    sent.push(body);
    return new Response(JSON.stringify({ messages: [{ id: "wamid.out" + Math.random().toString(36).slice(2) }] }));
  }
  // AI Gateway · Speech-to-Text
  if (u.endsWith("/v4/ai/transcription-model")) {
    log.push("stt");
    assert.equal(init.headers["ai-model-id"], "openai/gpt-4o-transcribe");
    const b = JSON.parse(init.body);
    assert.equal(b.mediaType, "audio/ogg", "mime limpio (sin codecs)");
    const id = Buffer.from(b.audio, "base64").toString().replace("OggS-fake-", "");
    if (sttMode === "fail") return new Response(JSON.stringify({ error: "not enabled" }), { status: 403 });
    return new Response(JSON.stringify({ text: sttMode === "empty" ? "" : transcripts.get(id) ?? "", language: "es" }));
  }
  // AI Gateway · Chat Completions (respaldo de audio, extractor JSON o agente)
  if (u.includes("ai-gateway.vercel.sh/v1/chat/completions")) {
    const b = JSON.parse(init.body);
    const filePart = b.messages?.[0]?.content?.find?.((p: any) => p.type === "file");
    if (filePart) {
      chatAudioCalls++;
      assert.match(filePart.file.file_data, /^data:audio\/ogg;base64,/);
      const id = Buffer.from(filePart.file.file_data.split(",")[1], "base64").toString().replace("OggS-fake-", "");
      return new Response(JSON.stringify({ choices: [{ message: { content: transcripts.get(id) ?? "" } }] }));
    }
    if (b.response_format?.type === "json_object") {
      log.push("nlu");
      const next = nluScript.shift();
      if (next === "fail") return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next ?? {}) } }] }));
    }
    log.push("agent");
    return new Response(JSON.stringify({ choices: [{ message: agentScript.shift() ?? { role: "assistant", content: "" } }] }));
  }
  throw new Error("fetch no simulado: " + u);
}) as any;

/* ── Helpers ──────────────────────────────────────────────────────── */
let n = 0;
const acc: any = { clinic_id: "", phone_number_id: "999000222", waba_id: "888", access_token: "tok" };
function voice(from: string, said: string) {
  const id = `media_${++n}`;
  transcripts.set(id, said);
  return { from, id: `wamid.v${n}`, type: "audio", audio: { id, mime_type: "audio/ogg; codecs=opus", voice: true } };
}
const txt = (from: string, body: string) => ({ from, id: `wamid.t${++n}`, type: "text", text: { body } });
const tap = (from: string, id: string) => ({ from, id: `wamid.i${++n}`, type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: id } } });
/** Límites oficiales de Meta para mensajes interactivos */
function validate(p: any) {
  if (p.type === "text") return assert.ok(p.text.body.length <= 4096);
  const i = p.interactive;
  if (i.footer) assert.ok(i.footer.text.length <= 60, `footer ≤60: ${i.footer.text}`);
  if (i.header) assert.ok(i.header.text.length <= 60);
  if (i.type === "list") {
    const r = i.action.sections.flatMap((s: any) => s.rows);
    assert.ok(r.length >= 1 && r.length <= 10, "lista 1..10 filas");
    for (const x of r) { assert.ok(x.title.length <= 24, `fila ≤24: ${x.title}`); assert.ok(!x.description || x.description.length <= 72); assert.ok(x.id.length <= 200); }
    assert.ok(i.action.button.length <= 20);
  }
  if (i.type === "button") for (const b of i.action.buttons) assert.ok(b.reply.title.length <= 20, `botón ≤20: ${b.reply.title}`);
}
async function say(msg: any) {
  const before = sent.length;
  await handleInbound(acc, msg, { wa_id: msg.from, profile: { name: "Paciente" } });
  const out = sent.slice(before);
  out.forEach(validate);
  for (const o of out) assert.ok(!/^🎤|Anot(é|ado):/.test(bodyOf(o) ?? ""), `no debe repetir la transcripción al paciente: ${bodyOf(o)}`);
  return out;
}
const rows = (p: any) => p.interactive.action.sections.flatMap((s: any) => s.rows);
const bodyOf = (p: any) => (p.type === "text" ? p.text.body : p.interactive.body.text);
const ok = (m: string) => console.log("✔", m);

async function main() {
  await pool.query("truncate clinics cascade");
  const { rows: [clinic] } = await pool.query(`insert into clinics(name, slug, address, city, min_notice_min, ai_enabled) values ('Clínica Voz','voz','Av. Siempre Viva 742','Santiago',0,false) returning *`);
  acc.clinic_id = clinic.id;
  await pool.query(`insert into whatsapp_accounts(clinic_id, phone_number_id, waba_id, access_token, display_phone) values ($1,'999000222','888','tok','+56 9 2222 2222')`, [clinic.id]);
  const { rows: [d] } = await pool.query(`insert into dentists(clinic_id, name) values ($1,'Dr. Soto') returning id`, [clinic.id]);
  const { rows: svcs } = await pool.query(`insert into services(clinic_id, name, duration_min, price, sort) values ($1,'Evaluación',30,15000,1),($1,'Limpieza dental',45,35000,2) returning id, name`, [clinic.id]);
  const LIMPIEZA = svcs.find((s: any) => s.name.startsWith("Limpieza")).id;
  const EVAL = svcs.find((s: any) => s.name === "Evaluación").id;
  // Lunes a sábado 09:00-18:00 (domingo cerrado)
  for (let wd = 1; wd <= 6; wd++) await pool.query(`insert into schedules(clinic_id, dentist_id, weekday, start_time, end_time) values ($1,$2,$3,'09:00','18:00')`, [clinic.id, d.id, wd]);

  process.env.AI_GATEWAY_API_KEY = "test"; // hay IA para transcribir; el consultorio parte con el agente desactivado (NLU determinista)
  const today = ymdInTz(new Date(), clinic.timezone);
  let target = addDaysYmd(today, 2);
  while (weekdayOfYmd(target) === 0) target = addDaysYmd(target, 1);
  const tWord = WEEK[weekdayOfYmd(target)];
  let sunday = addDaysYmd(today, 1);
  while (weekdayOfYmd(sunday) !== 0) sunday = addDaysYmd(sunday, 1);

  /* ═══ A) Formulario completo en 5 notas de voz (sin IA de extracción) ═══ */
  const P1 = "56911110001";
  let out = await say(voice(P1, "Hola, buenas tardes, quiero agendar una limpieza"));
  assert.equal(out.length, 1, "responde directo, sin eco de la transcripción");
  assert.equal(out[0].interactive.type, "list"); assert.ok(rows(out[0])[0].id.startsWith("day:"), "pide el día"); assert.match(bodyOf(out[0]), /Limpieza dental/);
  const { rows: [m1] } = await pool.query(`select body, type, payload from messages where wa_message_id=$1`, [`wamid.v${n}`]);
  assert.equal(m1.body, "🎤 Hola, buenas tardes, quiero agendar una limpieza"); assert.equal(m1.type, "audio"); assert.equal(m1.payload.transcript, "Hola, buenas tardes, quiero agendar una limpieza");
  ok("Audio 1: transcrito, sin eco al paciente, guardado en la bandeja y pide el día");

  out = await say(voice(P1, `El ${tWord} en la tarde, por favor`));
  assert.equal(out.length, 1);
  const pmRows = rows(out[0]);
  assert.ok(pmRows.length > 0 && pmRows.every((r: any) => r.title >= "13:00"), "solo horarios de la tarde");
  ok(`Audio 2: “el ${tWord} en la tarde” → ${pmRows.length} horarios ≥ 13:00`);

  out = await say(voice(P1, "a las 4"));
  assert.match(bodyOf(out[out.length - 1]), /nombre y apellido/i);
  ok("Audio 3: “a las 4” → 16:00 disponible → pide nombre");

  out = await say(voice(P1, "Me llamo Camila Rojas"));
  const conf = out[out.length - 1];
  assert.equal(conf.interactive.type, "button"); assert.match(bodyOf(conf), /Camila/); assert.match(bodyOf(conf), /16:00/); assert.match(bodyOf(conf), /Limpieza dental/);
  ok("Audio 4: nombre por voz → resumen con botones Confirmar");

  out = await say(voice(P1, "Sí, confírmala por favor"));
  assert.match(bodyOf(out[out.length - 1]), /agendada/);
  const { rows: [a1] } = await pool.query(`select a.*, p.full_name from appointments a join patients p on p.id=a.patient_id where p.phone=$1`, [P1]);
  assert.equal(a1.full_name, "Camila Rojas"); assert.equal(a1.service_id, LIMPIEZA); assert.equal(a1.channel, "whatsapp");
  assert.equal(ymdInTz(a1.starts_at, clinic.timezone), target);
  assert.equal(new Intl.DateTimeFormat("es-CL", { timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(a1.starts_at), "16:00");
  const { rows: [cv1] } = await pool.query(`select state from conversations where wa_id=$1`, [P1]);
  assert.equal(cv1.state.step, undefined); assert.equal(cv1.state.wantHm, undefined);
  ok("Audio 5: “sí, confírmala” → cita creada 16:00 y borrador limpio");

  /* ═══ B) Todo en un solo audio + cambio de hora por voz + confirmación escrita ═══ */
  const P2 = "56911110002";
  await pool.query(`insert into patients(clinic_id, phone, full_name) values ($1,$2,'Pedro Pérez')`, [clinic.id, P2]);
  out = await say(voice(P2, `Necesito una evaluación para el ${tWord} a las 10 y media`));
  assert.equal(out.length, 1);
  assert.equal(out[0].interactive.type, "button"); assert.match(bodyOf(out[0]), /10:30/); assert.match(bodyOf(out[0]), /Evaluación/);
  ok("Un solo audio con servicio + día + hora → directo a confirmar (paciente conocido)");

  out = await say(voice(P2, "mejor a las 11"));
  assert.match(bodyOf(out[out.length - 1]), /11:00/);
  out = await say(txt(P2, "sí"));
  assert.match(bodyOf(out[0]), /agendada/);
  const { rows: [a2] } = await pool.query(`select a.service_id, a.starts_at from appointments a join patients p on p.id=a.patient_id where p.phone=$1`, [P2]);
  assert.equal(a2.service_id, EVAL);
  ok("“mejor a las 11” mantiene el día y cambia la hora; “sí” escrito confirma");

  /* ═══ C) Hora ocupada → alternativas más cercanas ═══ */
  const P3 = "56911110003";
  out = await say(voice(P3, `quiero una limpieza el ${tWord} a las 4`));
  const near = rows(out[out.length - 1]);
  assert.match(bodyOf(out[out.length - 1]), /16:00\* no me queda hora/);
  assert.ok(!near.some((r: any) => r.title === "16:00 hrs"), "16:00 ya está tomada");
  assert.ok(near.some((r: any) => r.title === "15:00 hrs" || r.title === "16:45 hrs"), "ofrece las más cercanas");
  ok(`Hora ocupada → ${near.length} alternativas cercanas: ${near.slice(0, 4).map((r: any) => r.title).join(", ")}…`);

  /* ═══ D) Día sin atención ═══ */
  out = await say(voice(P3, `mejor el domingo ${Number(sunday.slice(8))}`));
  assert.match(out.map(bodyOf).join("\n"), /no me quedan horas/);
  assert.ok(rows(out[out.length - 1])[0].id.startsWith("day:"));
  ok("Domingo (cerrado) → avisa y muestra días con horas");

  /* ═══ E) Cancelar por voz a mitad del formulario ═══ */
  out = await say(voice(P3, "no, cancela todo mejor"));
  assert.match(bodyOf(out[0]), /no se agendó nada/);
  ok("“cancela todo” → aborta y limpia el borrador");

  /* ═══ F) Datos dichos antes de elegir servicio se conservan ═══ */
  const P4 = "56911110004";
  await pool.query(`insert into patients(clinic_id, phone, full_name) values ($1,$2,'Ana Díaz')`, [clinic.id, P4]);
  out = await say(voice(P4, `quiero hora para el ${tWord} a las 12`));
  assert.ok(rows(out[out.length - 1])[0].id.startsWith("svc:"), "pide servicio");
  out = await say(tap(P4, `svc:${EVAL}`));
  assert.match(bodyOf(out[out.length - 1]), /12:00/); assert.equal(out[out.length - 1].interactive.type, "button");
  ok("Día y hora dichos primero + servicio tocado en la lista → directo a confirmar");

  /* ═══ G) Modo IA: el extractor entiende lo que el parser no, y se valida ═══ */
  await pool.query(`update clinics set ai_enabled=true where id=$1`, [clinic.id]);
  const P5 = "56911110005";
  await pool.query(`insert into patients(clinic_id, phone, full_name) values ($1,$2,'Luis Mena')`, [clinic.id, P5]);
  nluScript = [{ intencion: "agendar", servicio_id: LIMPIEZA, fecha: target, hora: "09:15" }];
  out = await say(voice(P5, "eeh para lo de los dientes, el día ese que dije, apenas abran"));
  assert.match(bodyOf(out[out.length - 1]), /09:15/); assert.match(bodyOf(out[out.length - 1]), /Limpieza/);
  ok("IA: frase ambigua → JSON del modelo (validado) → confirmar 09:15");

  const P6 = "56911110006";
  nluScript = [{ intencion: "agendar", servicio_id: "servicio-inventado", fecha: "2019-01-01", hora: "99:99" }];
  out = await say(voice(P6, `una evaluación el ${tWord}`));
  assert.ok(rows(out[out.length - 1])[0].title.endsWith("hrs"), "usó lo del parser: evaluación + día → horarios");
  ok("IA devuelve datos inválidos → se descartan y se usa el parser determinista");

  nluScript = ["fail"];
  out = await say(voice(P6, "a las 10"));
  assert.match(bodyOf(out[out.length - 1]), /nombre y apellido/i);
  ok("IA de extracción caída → el formulario sigue funcionando");

  /* ═══ H) Pregunta por audio que no es reserva → la responde el agente ═══ */
  const P7 = "56911110007";
  nluScript = [{ intencion: "otra" }];
  agentScript = [
    { role: "assistant", content: null, tool_calls: [{ id: "x1", type: "function", function: { name: "info_consultorio", arguments: "{}" } }] },
    { role: "assistant", content: "" },
  ];
  log.length = 0;
  out = await say(voice(P7, "¿dónde quedan ustedes?"));
  assert.deepEqual(log, ["stt", "nlu", "agent", "agent"], "el extractor dice “otra” → pasa al agente");
  assert.equal(out[0].interactive.type, "cta_url"); assert.match(bodyOf(out[0]), /Siempre Viva/);
  ok("Audio con pregunta → agente IA responde con ubicación (botón Maps)");

  /* ═══ I) Respaldo de transcripción y fallos ═══ */
  sttMode = "fail";
  const P8 = "56911110008";
  nluScript = [{}];
  out = await say(voice(P8, "quiero agendar una evaluación"));
  assert.equal(chatAudioCalls, 1, "usó el modelo multimodal de respaldo");
  const { rows: [m8] } = await pool.query(`select body from messages where wa_message_id=$1`, [`wamid.v${n}`]);
  assert.equal(m8.body, "🎤 quiero agendar una evaluación");
  ok("STT no habilitado → respaldo multimodal (Gemini) transcribe igual");

  sttMode = "empty"; transcripts.clear();
  out = await say(voice(P8, ""));
  assert.match(bodyOf(out[0]), /No logré entender/);
  ok("Audio ininteligible → pide repetir o escribir");

  sttMode = "ok";
  delete process.env.AI_GATEWAY_API_KEY;
  out = await say(voice("56911110009", "hola"));
  assert.match(bodyOf(out[0]), /no puedo escuchar audios/);
  process.env.AI_GATEWAY_API_KEY = "test";
  ok("Sin IA configurada → avisa que escriba");

  /* ═══ J) Modo humano: se transcribe para recepción pero el bot no responde ═══ */
  const P10 = "56911110010";
  await say(txt(P10, "hola"));
  await pool.query(`update conversations set mode='human' where wa_id=$1`, [P10]);
  out = await say(voice(P10, "hola, quería saber si mi examen salió bien"));
  assert.equal(out.length, 0);
  const { rows: [m10] } = await pool.query(`select body from messages where wa_message_id=$1`, [`wamid.v${n}`]);
  assert.equal(m10.body, "🎤 hola, quería saber si mi examen salió bien");
  ok("Modo humano: audio transcrito en la bandeja, el bot no interviene");

  /* ═══ K) También se puede responder el formulario escribiendo ═══ */
  await pool.query(`update clinics set ai_enabled=false where id=$1`, [clinic.id]);
  const P11 = "56911110011";
  await pool.query(`insert into patients(clinic_id, phone, full_name) values ($1,$2,'Sofía Lagos')`, [clinic.id, P11]);
  await say(tap(P11, "book"));
  out = await say(tap(P11, `svc:${LIMPIEZA}`));
  assert.equal(out[0].interactive.type, "list");
  out = await say(txt(P11, `el ${tWord} a las 12`));
  assert.match(bodyOf(out[out.length - 1]), /12:00/); assert.equal(out[out.length - 1].interactive.type, "button");
  ok("Texto “el <día> a las 12” mientras ve la lista de días → directo a confirmar");

  console.log(`\nNotas de voz: todos los escenarios OK · ${sent.length} mensajes enviados, validados contra los límites de Meta.`);
  await pool.end();
}

main().catch(async (e) => { console.error("✘ FALLÓ:", e); await pool.end(); process.exit(1); });
