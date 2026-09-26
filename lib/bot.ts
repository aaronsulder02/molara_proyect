// Motor conversacional de WhatsApp: botones/listas nativas de Meta + agente IA (Vercel AI Gateway).
import { db } from "./supabase";
import { wa, sendWa, markReadTyping, type WaAccount, type Row } from "./whatsapp";
import { getAvailableDays, getSlots, listServices, getService } from "./availability";
import { bookAppointment, setAppointmentStatus, upcomingForPatient, upsertPatient } from "./booking";
import { humanDateTime, longDayLabel, shortDayLabel, ymdInTz, hmInTz } from "./time.ts";
import { aiAvailable, runAgent, completeJson, type ChatMsg, type ToolDef } from "./ai";
import { downloadWaMedia, transcribeAudio } from "./voice";
import { parseEs, mergeFields, extractionPrompt, type FormStep, type Range } from "./nlu";

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const money = (n?: number | null) => (n ? "$" + n.toLocaleString("es-CL") : "Consultar");
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

type Ctx = {
  acc: WaAccount;
  clinic: any;
  conv: any;
  patient: any | null;
  to: string;
  send: (payload: any, author?: string) => Promise<{ ok: boolean; error?: string }>;
  setState: (patch: Record<string, any>) => Promise<void>;
};

/* ════════════════════════════════════════════════════════════════════
   Entrada principal del webhook
   ════════════════════════════════════════════════════════════════════ */
export async function handleInbound(acc: WaAccount, msg: any, contact: any) {
  const { data: clinic } = await db().from("clinics").select("*").eq("id", acc.clinic_id).single();
  if (!clinic) return;
  const waId: string = msg.from;
  const profileName: string | undefined = contact?.profile?.name;

  // Conversación (una por paciente y consultorio)
  let { data: conv } = await db().from("conversations").select("*").eq("clinic_id", clinic.id).eq("wa_id", waId).maybeSingle();
  const isNew = !conv;
  if (!conv) {
    const { data: created, error } = await db()
      .from("conversations")
      .insert({ clinic_id: clinic.id, wa_id: waId, profile_name: profileName ?? null })
      .select("*")
      .single();
    if (error) {
      ({ data: conv } = await db().from("conversations").select("*").eq("clinic_id", clinic.id).eq("wa_id", waId).single());
    } else conv = created;
  }

  // Guardar mensaje entrante (idempotente por wa_message_id)
  const { text, replyId, kind } = parseIncoming(msg);
  const { error: dupErr } = await db().from("messages").insert({
    clinic_id: clinic.id,
    conversation_id: conv.id,
    direction: "in",
    author: "patient",
    type: kind,
    body: text || replyId || `[${msg.type}]`,
    payload: msg,
    wa_message_id: msg.id,
    status: "received",
  });
  if (dupErr?.code === "23505") return; // reintento de Meta: ya procesado

  let { data: patient } = await db().from("patients").select("*").eq("clinic_id", clinic.id).eq("phone", waId).maybeSingle();
  if (!patient) {
    patient = await upsertPatient(clinic.id, waId, { full_name: null });
  }
  await db()
    .from("conversations")
    .update({
      last_message: (text || replyId || "").slice(0, 140),
      last_message_at: new Date().toISOString(),
      last_inbound_at: new Date().toISOString(),
      unread: (conv.unread ?? 0) + 1,
      profile_name: profileName ?? conv.profile_name,
      patient_id: patient?.id ?? conv.patient_id,
    })
    .eq("id", conv.id);

  await markReadTyping(acc, msg.id);

  const ctx: Ctx = {
    acc,
    clinic,
    conv,
    patient,
    to: waId,
    send: (payload, author = "bot") => sendWa(acc, waId, payload, { conversationId: conv.id, author }),
    setState: async (patch) => {
      ctx.conv.state = { ...(ctx.conv.state || {}), ...patch };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete ctx.conv.state[k];
      await db().from("conversations").update({ state: ctx.conv.state }).eq("id", conv.id);
    },
  };

  // Nota de voz → transcripción (también en modo humano, para que recepción la lea en la bandeja)
  let voiceText = "";
  if (kind === "audio") voiceText = await transcribeInbound(ctx, msg);

  // Modo humano: el bot no responde (salvo que el paciente pida volver al menú)
  if (conv.mode === "human") {
    if (text && ["menu", "menú", "bot", "asistente", "inicio"].includes(norm(text))) {
      await db().from("conversations").update({ mode: "bot" }).eq("id", conv.id);
      return sendMenu(ctx, true);
    }
    return;
  }

  try {
    if (replyId) return await route(ctx, replyId);
    if (kind === "text" && text) return await onText(ctx, text, isNew);
    if (kind === "audio") return await onVoice(ctx, voiceText, isNew);
    await ctx.send(wa.text("Por ahora puedo leer mensajes de texto y escuchar notas de voz 🙂"));
    return sendMenu(ctx);
  } catch (e: any) {
    console.error("[bot] error", e);
    await ctx.send(wa.buttons("Tuve un problema procesando tu solicitud 😓. ¿Quieres intentarlo de nuevo o hablar con recepción?", [
      { id: "menu", title: "Menú principal" },
      { id: "human", title: "Hablar con recepción" },
    ]));
  }
}

function parseIncoming(msg: any): { text: string; replyId: string; kind: string } {
  switch (msg.type) {
    case "text":
      return { text: msg.text?.body ?? "", replyId: "", kind: "text" };
    case "interactive": {
      const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      return { text: r?.title ?? "", replyId: r?.id ?? "", kind: "interactive" };
    }
    case "button": // respuesta rápida de plantilla
      return { text: msg.button?.text ?? "", replyId: msg.button?.payload ?? "", kind: "button" };
    case "audio":
      return { text: "", replyId: "", kind: "audio" };
    default:
      return { text: "", replyId: "", kind: msg.type };
  }
}

/* ════════════════════════════════════════════════════════════════════
   Enrutador de botones / listas
   ════════════════════════════════════════════════════════════════════ */
async function route(ctx: Ctx, id: string) {
  const [cmd, a, ...rest] = id.split(":");
  const b = rest.join(":"); // los ISO contienen ':'
  switch (cmd) {
    case "menu": return sendMenu(ctx);
    case "book": return showServices(ctx);
    case "svc": {
      const st = ctx.conv.state || {};
      if (st.wantYmd || st.wantHm || st.wantRange) { await ctx.setState({ serviceId: a, pending: undefined }); return advance(ctx); }
      return showDays(ctx, a);
    }
    case "day": {
      const st = ctx.conv.state || {};
      if (st.wantHm || st.wantRange) { await ctx.setState({ wantYmd: a }); return advance(ctx); }
      return showSlots(ctx, a, 0);
    }
    case "more": return showSlots(ctx, a, Number(rest[0] || 0));
    case "slot": return pickSlot(ctx, a, b);
    case "ok": return doBook(ctx);
    case "change": return ctx.conv.state?.serviceId ? showDays(ctx, ctx.conv.state.serviceId) : showServices(ctx);
    case "abort":
      await ctx.setState({ pending: undefined, awaiting: undefined, rescheduleId: undefined, ...CLEAR_DRAFT });
      return ctx.send(wa.buttons("Listo, no se agendó nada. ¿Te ayudo con algo más?", [
        { id: "book", title: "📅 Agendar hora" },
        { id: "menu", title: "Menú principal" },
      ]));
    case "mine": return showMine(ctx);
    case "appt": return apptActions(ctx, a);
    case "aok": return confirmAttendance(ctx, a);
    case "acx": return askCancel(ctx, a);
    case "acx2": return doCancel(ctx, a);
    case "arb": return startReschedule(ctx, a);
    case "services": return showPrices(ctx);
    case "info": return showInfo(ctx);
    case "web": return sendWebLink(ctx);
    case "human": return handoff(ctx, "El paciente pidió hablar con recepción");
    default: return sendMenu(ctx);
  }
}

/* ════════════════════════════════════════════════════════════════════
   Texto libre: nombre pendiente → IA → palabras clave
   ════════════════════════════════════════════════════════════════════ */
async function onText(ctx: Ctx, text: string, isNew: boolean) {
  const st = ctx.conv.state || {};

  // Si el paciente está llenando el formulario de reserva, lo que escribe completa los campos
  if (st.step || st.awaiting === "name") {
    if (await fillForm(ctx, text, "text")) return;
  }

  if (st.awaiting === "name") {
    const name = text.trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 60 || /\d/.test(name)) {
      return ctx.send(wa.text("¿Me escribes tu nombre y apellido, por favor? (ej: Camila Rojas)"));
    }
    ctx.patient = await upsertPatient(ctx.clinic.id, ctx.to, { full_name: titleCase(name) });
    await ctx.setState({ awaiting: undefined });
    return confirmPrompt(ctx);
  }

  const t = norm(text);
  if (["menu", "menú", "inicio", "opciones"].includes(t)) return sendMenu(ctx, false);

  if (aiAvailable() && ctx.clinic.ai_enabled !== false) {
    try {
      return await agentReply(ctx, isNew);
    } catch (e) {
      console.error("[bot] IA no disponible, uso reglas:", e);
    }
  }
  return keywordRoute(ctx, t, isNew);
}

async function keywordRoute(ctx: Ctx, t: string, isNew: boolean) {
  if (/(urgencia|urgente|dolor|sangr|hinchad|accidente)/.test(t)) {
    await ctx.send(wa.text("Siento que estés con molestias 😟. Te comunico con recepción para darte prioridad."));
    return handoff(ctx, "Posible urgencia dental");
  }
  if (/(mis citas|mi cita|mi hora|cancel|anul|reagend|cambiar|confirm)/.test(t)) return showMine(ctx);
  if (/(agend|reserv|hora|cita|turno|evaluacion|atender|disponib)/.test(t)) return showServices(ctx);
  if (/(precio|valor|cuanto|costo|arancel|servicio|tratamiento)/.test(t)) return showPrices(ctx);
  if (/(direcc|ubicac|donde|horario|abren|cierran|llegar)/.test(t)) return showInfo(ctx);
  if (/(humano|persona|recepci|secretari|ejecutiv|hablar con)/.test(t)) return handoff(ctx, "Solicitud de atención humana");
  return sendMenu(ctx, isNew || /(hola|buen|alo|hey|saludos)/.test(t));
}

/* ════════════════════════════════════════════════════════════════════
   Pantallas (mensajes interactivos)
   ════════════════════════════════════════════════════════════════════ */
export async function sendMenu(ctx: Ctx, greet = true) {
  const st = ctx.conv.state || {};
  if (st.step || st.wantYmd || st.wantHm || st.wantRange) await ctx.setState(CLEAR_DRAFT);
  const name = ctx.patient?.full_name?.split(" ")[0];
  const hello = greet
    ? `${ctx.clinic.bot_welcome || "¡Hola! 👋"}${name ? `\n\nQué gusto saludarte, ${name}.` : ""}\n\n`
    : "";
  return ctx.send(
    wa.list(`${hello}¿En qué te puedo ayudar hoy?`, "Ver opciones", [
      {
        title: "Citas",
        rows: [
          { id: "book", title: "📅 Agendar una hora", description: "Elige servicio, día y horario en segundos" },
          { id: "mine", title: "🗓️ Mis citas", description: "Confirmar, reagendar o cancelar" },
        ],
      },
      {
        title: "Información",
        rows: [
          { id: "services", title: "🦷 Servicios y precios" },
          { id: "info", title: "📍 Ubicación y horarios" },
          { id: "web", title: "🌐 Reservar en la web" },
          { id: "human", title: "💬 Hablar con recepción", description: "Te atiende una persona del equipo" },
        ],
      },
    ], { header: ctx.clinic.name, footer: `${ctx.clinic.bot_name} · asistente virtual` })
  );
}

async function showServices(ctx: Ctx) {
  const services = await listServices(ctx.clinic.id);
  if (!services.length) {
    await ctx.send(wa.text("Aún no tenemos servicios publicados para reserva automática."));
    return handoff(ctx, "Sin servicios configurados");
  }
  if (services.length === 1) return showDays(ctx, services[0].id);
  await ctx.setState({ step: "service" });
  return ctx.send(
    wa.list("¿Qué tipo de atención necesitas? 🦷", "Elegir servicio", [
      {
        title: "Servicios",
        rows: services.slice(0, 10).map((s: any) => ({
          id: `svc:${s.id}`,
          title: s.name,
          description: `${s.duration_min} min · ${money(s.price)}${s.description ? " · " + s.description : ""}`,
        })),
      },
    ], { header: "Agendar hora", footer: "Paso 1 de 3" })
  );
}

async function showDays(ctx: Ctx, serviceId: string) {
  const service = await getService(ctx.clinic.id, serviceId);
  if (!service) return showServices(ctx);
  await ctx.setState({ serviceId, pending: undefined, step: "day" });
  const days = await getAvailableDays(ctx.clinic, { serviceId, limit: 10 });
  if (!days.length) {
    return ctx.send(wa.buttons(
      `No encontré horarios disponibles para *${service.name}* en los próximos días 😕. ¿Quieres que recepción te contacte?`,
      [{ id: "human", title: "Sí, contáctenme" }, { id: "book", title: "Otro servicio" }, { id: "menu", title: "Menú" }]
    ));
  }
  return ctx.send(
    wa.list(`*${service.name}* (${service.duration_min} min)\n¿Qué día te acomoda?`, "Elegir día", [
      { title: "Días disponibles", rows: days.map((d) => ({ id: `day:${d.ymd}`, title: shortDayLabel(d.ymd), description: `${d.count} horario${d.count === 1 ? "" : "s"} libre${d.count === 1 ? "" : "s"}` })) },
    ], { header: "Agendar hora", footer: "Paso 2 de 3" })
  );
}

async function showSlots(ctx: Ctx, ymd: string, offset: number) {
  const serviceId = ctx.conv.state?.serviceId;
  if (!serviceId) return showServices(ctx);
  await ctx.setState({ ymd, step: "slot" });
  const slots = await getSlots(ctx.clinic, { serviceId, ymd, collapse: true });
  if (!slots.length) {
    await ctx.send(wa.text("Ese día se acaba de llenar 😅. Te muestro otros días:"));
    return showDays(ctx, serviceId);
  }
  const page = slots.slice(offset);
  const hasMore = page.length > 10;
  const rows: Row[] = (hasMore ? page.slice(0, 9) : page.slice(0, 10)).map((s) => ({
    id: `slot:${s.dentistId}:${s.start}`,
    title: `${s.hm} hrs`,
    description: `con ${s.dentistName}`,
  }));
  if (hasMore) rows.push({ id: `more:${ymd}:${offset + 9}`, title: "Más horarios →", description: "Ver horarios más tarde" });
  return ctx.send(
    wa.list(`Horarios para el *${longDayLabel(ymd)}* 🕒`, "Elegir horario", [{ title: "Horarios", rows }], {
      header: "Agendar hora",
      footer: "Paso 3 de 3",
    })
  );
}

async function pickSlot(ctx: Ctx, dentistId: string, startISO: string) {
  await ctx.setState({ pending: { dentistId, start: startISO } });
  if (!ctx.patient?.full_name) {
    await ctx.setState({ awaiting: "name", step: "name" });
    return ctx.send(wa.text("¡Excelente elección! ✨ Para dejar la hora a tu nombre, ¿me indicas tu *nombre y apellido*? (puedes escribirlo o decirlo en un audio 🎤)"));
  }
  return confirmPrompt(ctx);
}

async function confirmPrompt(ctx: Ctx) {
  const st = ctx.conv.state || {};
  if (!st.pending || !st.serviceId) return showServices(ctx);
  await ctx.setState({ step: "confirm", awaiting: undefined });
  const service = await getService(ctx.clinic.id, st.serviceId);
  const { data: dentist } = await db().from("dentists").select("name").eq("id", st.pending.dentistId).maybeSingle();
  const lines = [
    `Revisa tu reserva, ${ctx.patient?.full_name?.split(" ")[0] ?? ""}:`,
    "",
    `🦷 *${service?.name}* · ${service?.duration_min} min`,
    `👩‍⚕️ ${dentist?.name ?? "Profesional"}`,
    `📅 ${humanDateTime(st.pending.start, ctx.clinic.timezone)}`,
    ctx.clinic.address ? `📍 ${ctx.clinic.address}` : "",
    service?.price ? `💳 ${money(service.price)}` : "",
  ].filter(Boolean);
  return ctx.send(
    wa.buttons(lines.join("\n"), [
      { id: "ok", title: "✅ Confirmar" },
      { id: "change", title: "🔄 Otro horario" },
      { id: "abort", title: "✖️ Cancelar" },
    ], { header: st.rescheduleId ? "Reagendar cita" : "Confirmar reserva" })
  );
}

async function doBook(ctx: Ctx) {
  const st = ctx.conv.state || {};
  if (!st.pending || !st.serviceId) return showServices(ctx);
  const res = await bookAppointment({
    clinic: ctx.clinic,
    serviceId: st.serviceId,
    startISO: st.pending.start,
    dentistId: st.pending.dentistId,
    patient: { phone: ctx.to, full_name: ctx.patient?.full_name },
    channel: "whatsapp",
  });
  if (!res.ok) {
    await ctx.send(wa.text(`😕 ${res.error}`));
    return showDays(ctx, st.serviceId);
  }
  if (st.rescheduleId) {
    await setAppointmentStatus(ctx.clinic.id, st.rescheduleId, "cancelled").catch(() => null);
  }
  await ctx.setState({ pending: undefined, rescheduleId: undefined, ymd: undefined, ...CLEAR_DRAFT });
  const a = res.appointment;
  return ctx.send(
    wa.buttons(
      `✅ *¡Hora ${st.rescheduleId ? "reagendada" : "agendada"}!*\n\n🦷 ${a.service?.name}\n👩‍⚕️ ${a.dentist?.name}\n📅 ${humanDateTime(a.starts_at, ctx.clinic.timezone)}${ctx.clinic.address ? `\n📍 ${ctx.clinic.address}` : ""}\n\nTe enviaremos un recordatorio el día anterior. Llega 10 minutos antes 😊`,
      [{ id: "mine", title: "🗓️ Mis citas" }, { id: "menu", title: "Menú principal" }],
      { footer: ctx.clinic.name }
    )
  );
}

async function showMine(ctx: Ctx) {
  if (ctx.conv.state?.step) await ctx.setState({ step: undefined });
  const list = await upcomingForPatient(ctx.clinic.id, ctx.to);
  if (!list.length) {
    return ctx.send(wa.buttons("No tienes horas agendadas próximamente. ¿Quieres reservar una?", [
      { id: "book", title: "📅 Agendar hora" },
      { id: "menu", title: "Menú principal" },
    ]));
  }
  if (list.length === 1) return apptActions(ctx, list[0].id);
  const tz = ctx.clinic.timezone;
  return ctx.send(
    wa.list("Estas son tus próximas horas. Elige una para confirmarla, reagendarla o cancelarla:", "Ver mis citas", [
      {
        title: "Próximas citas",
        rows: list.map((a: any) => ({
          id: `appt:${a.id}`,
          title: `${shortDayLabel(ymdInTz(new Date(a.starts_at), tz))} ${hmInTz(new Date(a.starts_at), tz)}`,
          description: `${a.service?.name ?? "Atención"} · ${a.dentist?.name ?? ""}${a.status === "confirmed" ? " · ✅ confirmada" : ""}`,
        })),
      },
    ])
  );
}

async function apptActions(ctx: Ctx, id: string) {
  const { data: a } = await db()
    .from("appointments")
    .select("id, starts_at, status, dentist:dentists(name), service:services(name)")
    .eq("clinic_id", ctx.clinic.id)
    .eq("id", id)
    .maybeSingle();
  if (!a) {
    return ctx.send(wa.buttons("No encontré esa cita 🤔. Puede que ya haya sido modificada.", [
      { id: "book", title: "📅 Agendar hora" },
      { id: "menu", title: "Menú principal" },
    ]));
  }
  const d: any = a;
  return ctx.send(
    wa.buttons(
      `🗓️ *${d.service?.name ?? "Atención"}*\n👩‍⚕️ ${d.dentist?.name}\n📅 ${humanDateTime(d.starts_at, ctx.clinic.timezone)}\nEstado: ${d.status === "confirmed" ? "✅ Confirmada" : "⏳ Por confirmar"}`,
      [
        { id: `aok:${id}`, title: "✅ Confirmo" },
        { id: `arb:${id}`, title: "🔄 Reagendar" },
        { id: `acx:${id}`, title: "❌ Cancelar cita" },
      ],
      { header: "Tu cita" }
    )
  );
}

async function confirmAttendance(ctx: Ctx, id: string) {
  const a = await setAppointmentStatus(ctx.clinic.id, id, "confirmed").catch(() => null);
  if (!a) return ctx.send(wa.text("No pude confirmar esa cita. Escribe *menú* para ver tus opciones."));
  return ctx.send(wa.text(`¡Gracias por confirmar! 🙌 Te esperamos el ${humanDateTime(a.starts_at, ctx.clinic.timezone)}.`));
}

async function askCancel(ctx: Ctx, id: string) {
  return ctx.send(wa.buttons("¿Seguro que quieres cancelar esta hora? El horario quedará libre para otro paciente.", [
    { id: `acx2:${id}`, title: "Sí, cancelar" },
    { id: `arb:${id}`, title: "Mejor reagendar" },
    { id: "menu", title: "No, volver" },
  ]));
}

async function doCancel(ctx: Ctx, id: string) {
  await setAppointmentStatus(ctx.clinic.id, id, "cancelled");
  return ctx.send(wa.buttons("Tu hora fue cancelada. Cuando quieras, agendamos una nueva 😊", [
    { id: "book", title: "📅 Agendar nueva" },
    { id: "menu", title: "Menú principal" },
  ]));
}

async function startReschedule(ctx: Ctx, id: string) {
  const { data: a } = await db().from("appointments").select("id, service_id").eq("clinic_id", ctx.clinic.id).eq("id", id).maybeSingle();
  if (!a?.service_id) return showMine(ctx);
  await ctx.setState({ rescheduleId: id });
  await ctx.send(wa.text("Perfecto, busquemos un nuevo horario. Tu hora actual se liberará solo cuando confirmes la nueva 👌"));
  return showDays(ctx, a.service_id);
}

async function showPrices(ctx: Ctx) {
  const services = await listServices(ctx.clinic.id);
  const body = services.length
    ? "🦷 *Servicios y valores*\n\n" + services.map((s: any) => `• *${s.name}* — ${money(s.price)} (${s.duration_min} min)`).join("\n") + "\n\n_Valores referenciales, sujetos a evaluación._"
    : "Consulta nuestros valores con recepción.";
  return ctx.send(wa.buttons(body, [{ id: "book", title: "📅 Agendar hora" }, { id: "menu", title: "Menú principal" }]));
}

async function showInfo(ctx: Ctx) {
  const c = ctx.clinic;
  const lines = [
    `🏥 *${c.name}*`,
    c.address ? `📍 ${c.address}${c.city ? ", " + c.city : ""}` : "",
    c.hours_text ? `🕒 ${c.hours_text}` : "",
    c.phone ? `📞 ${c.phone}` : "",
  ].filter(Boolean);
  if (c.address) {
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.address} ${c.city ?? ""}`)}`;
    return ctx.send(wa.cta(lines.join("\n"), "Abrir en Maps", maps, { footer: "Toca para ver cómo llegar" }));
  }
  return ctx.send(wa.buttons(lines.join("\n"), [{ id: "book", title: "📅 Agendar hora" }, { id: "menu", title: "Menú principal" }]));
}

async function sendWebLink(ctx: Ctx) {
  const url = `${APP_URL()}/reservar/${ctx.clinic.slug}`;
  return ctx.send(wa.cta("También puedes reservar desde nuestra agenda online, con todos los horarios a la vista 👇", "Reservar online", url, { footer: ctx.clinic.name }));
}

async function handoff(ctx: Ctx, reason: string) {
  await db().from("conversations").update({ mode: "human", state: { ...(ctx.conv.state || {}), handoffReason: reason } }).eq("id", ctx.conv.id);
  return ctx.send(wa.text("Listo 🙌 Le avisé a nuestro equipo de recepción y te responderán por este mismo chat a la brevedad.\n\nSi quieres volver al asistente, escribe *menú*."));
}

/* ════════════════════════════════════════════════════════════════════
   Notas de voz + formulario de reserva conversacional
   El paciente puede dictar (o escribir) servicio, día, hora y nombre en uno o varios
   mensajes; cada dato se guarda en un borrador y el bot pregunta solo lo que falta.
   ════════════════════════════════════════════════════════════════════ */
const CLEAR_DRAFT = { step: undefined, wantYmd: undefined, wantHm: undefined, wantRange: undefined } as const;
const RANGE_LABEL: Record<Range, string> = { am: "mañana", pm: "tarde", noche: "noche" };
const inRange = (hm: string, r: Range) => (r === "am" ? hm < "13:00" : r === "pm" ? hm >= "13:00" && hm < "19:00" : hm >= "19:00");
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

async function transcribeInbound(ctx: Ctx, msg: any): Promise<string> {
  let transcript = "";
  try {
    if (msg.audio?.id && aiAvailable()) {
      const media = await downloadWaMedia(ctx.acc, msg.audio.id);
      transcript = (await transcribeAudio(media.data, media.mime)).text;
    }
  } catch (e) {
    console.warn("[voice] no se pudo transcribir:", (e as Error).message);
  }
  const body = transcript ? `🎤 ${transcript}` : "🎤 Nota de voz";
  await db().from("messages").update({ body, payload: { ...msg, transcript: transcript || null } }).eq("wa_message_id", msg.id);
  await db().from("conversations").update({ last_message: body.slice(0, 140) }).eq("id", ctx.conv.id);
  return transcript;
}

async function onVoice(ctx: Ctx, transcript: string, isNew: boolean) {
  if (!transcript) {
    return ctx.send(wa.buttons(
      aiAvailable()
        ? "🎧 No logré entender bien tu audio. ¿Me lo repites o me lo escribes?"
        : "🎧 Por ahora no puedo escuchar audios. ¿Me lo escribes, por favor?",
      [{ id: "book", title: "📅 Agendar hora" }, { id: "menu", title: "Menú principal" }]
    ));
  }
  if (await fillForm(ctx, transcript, "audio")) return;
  return onText(ctx, transcript, isNew);
}

/** Qué está viendo el paciente (para que el modelo interprete "el primero", "ese", etc.). */
async function offeredOptions(ctx: Ctx, step: FormStep): Promise<string | undefined> {
  const st = ctx.conv.state || {};
  try {
    if (step === "day" && st.serviceId) {
      const days = await getAvailableDays(ctx.clinic, { serviceId: st.serviceId, limit: 10 });
      return days.map((d) => `${d.ymd} (${shortDayLabel(d.ymd)})`).join(", ");
    }
    if (step === "slot" && st.serviceId && st.ymd) {
      const slots = await getSlots(ctx.clinic, { serviceId: st.serviceId, ymd: st.ymd, collapse: true });
      return `Día ${st.ymd}: ` + slots.slice(0, 20).map((s) => s.hm).join(", ");
    }
    if (step === "confirm" && st.pending) return `Reserva por confirmar: ${humanDateTime(st.pending.start, ctx.clinic.timezone)}`;
  } catch {}
  return undefined;
}

/** Llena el formulario con lo que dijo/escribió el paciente. Devuelve false si no era sobre la reserva. */
async function fillForm(ctx: Ctx, utterance: string, source: "audio" | "text"): Promise<boolean> {
  const c = ctx.clinic;
  const tz = c.timezone;
  const st = ctx.conv.state || {};
  const step: FormStep = st.awaiting === "name" ? "name" : st.step;
  const services = await listServices(c.id);
  const now = new Date();
  const today = ymdInTz(now, tz);

  const det = parseEs(utterance, { today, services, step });
  let f = det;
  if (aiAvailable() && c.ai_enabled !== false) {
    const offered = await offeredOptions(ctx, step);
    const ai = await completeJson(extractionPrompt({ today, now: hmInTz(now, tz), step, services, offered }), utterance);
    f = mergeFields(ai, det, { today, services, windowDays: Math.min(c.booking_window_days || 30, 60) });
  }
  const hasData = !!(f.serviceId || f.ymd || f.hm || f.range);

  if (f.intent === "cancelar" && step) {
    await route(ctx, "abort");
    return true;
  }
  if (step === "name" && f.name) {
    ctx.patient = await upsertPatient(c.id, ctx.to, { full_name: titleCase(f.name) });
    await ctx.setState({ awaiting: undefined });
    if (!hasData && st.pending) {
      if (source === "audio") await ctx.send(wa.text(`🎤 Anotado: *${titleCase(f.name)}*`));
      await confirmPrompt(ctx);
      return true;
    }
  }
  if (step === "confirm" && f.intent === "confirmar" && st.pending) {
    // "sí, el jueves a las 4 está bien": confirma si lo dicho coincide con la reserva mostrada
    const pDay = ymdInTz(new Date(st.pending.start), tz);
    const pHm = hmInTz(new Date(st.pending.start), tz);
    const same = (!f.ymd || f.ymd === pDay) && (!f.hm || f.hm === pHm) && (!f.serviceId || f.serviceId === st.serviceId) && !f.range;
    if (same) { await doBook(ctx); return true; }
  }
  if (step === "confirm" && !hasData) {
    if (f.intent === "rechazar" || f.intent === "cambiar") { await route(ctx, "change"); return true; }
  }
  if (!hasData) return step === "name" && !!f.name;
  // Pregunta informativa que menciona un servicio ("¿cuánto cuesta la limpieza?") → la responde el agente
  if (f.intent === "otra" && !f.ymd && !f.hm && !f.range) return false;

  if (f.name && !ctx.patient?.full_name) ctx.patient = await upsertPatient(c.id, ctx.to, { full_name: titleCase(f.name) });

  const patch: Record<string, any> = { awaiting: undefined };
  if (f.serviceId && f.serviceId !== st.serviceId) Object.assign(patch, { serviceId: f.serviceId, pending: undefined });
  if (f.ymd) patch.wantYmd = f.ymd;
  else if (!st.wantYmd && (f.hm || f.range)) {
    // "mejor a las 5": mismo día que estaba mirando o el de la reserva por confirmar
    const day = st.pending?.start ? ymdInTz(new Date(st.pending.start), tz) : step === "slot" ? st.ymd : undefined;
    if (day) patch.wantYmd = day;
  }
  if (f.hm) Object.assign(patch, { wantHm: f.hm, wantRange: undefined });
  else if (f.range) Object.assign(patch, { wantRange: f.range, wantHm: undefined });
  if (step === "confirm") patch.pending = undefined;
  await ctx.setState(patch);
  await advance(ctx, source === "audio" ? utterance : undefined);
  return true;
}

/** Avanza el formulario pidiendo solo lo que falta y validando contra la disponibilidad real. */
async function advance(ctx: Ctx, heard?: string) {
  const c = ctx.clinic;
  let st = ctx.conv.state || {};
  const services = await listServices(c.id);
  if (!st.serviceId && services.length === 1) { await ctx.setState({ serviceId: services[0].id }); st = ctx.conv.state; }
  const svc = services.find((s: any) => s.id === st.serviceId);

  // Resumen de lo entendido (siempre tras un audio: el paciente ve qué escuchó el asistente)
  const parts = [
    svc ? `🦷 ${svc.name}` : "",
    st.wantYmd ? `📅 ${longDayLabel(st.wantYmd)}` : "",
    st.wantHm ? `🕓 ${st.wantHm} hrs` : st.wantRange ? `🕓 en la ${RANGE_LABEL[st.wantRange as Range]}` : "",
  ].filter(Boolean);
  if (heard) {
    const short = heard.length > 160 ? heard.slice(0, 157) + "…" : heard;
    await ctx.send(wa.text(`🎤 _“${short}”_${parts.length ? `\n📝 Anoté: ${parts.join(" · ")}` : ""}`));
  }

  if (!st.serviceId) return showServices(ctx);
  if (!st.wantYmd) return showDays(ctx, st.serviceId);

  const ymd: string = st.wantYmd;
  const slots = await getSlots(c, { serviceId: st.serviceId, ymd, collapse: true });
  await ctx.setState({ ymd, wantYmd: undefined });
  if (!slots.length) {
    await ctx.send(wa.text(`Para el *${longDayLabel(ymd)}* no me quedan horas de ${svc?.name ?? "ese servicio"} 😕. Estos días sí tienen:`));
    return showDays(ctx, st.serviceId);
  }
  if (st.wantHm) {
    const exact = slots.find((s) => s.hm === st.wantHm);
    await ctx.setState({ wantHm: undefined, wantRange: undefined });
    if (exact) return pickSlot(ctx, exact.dentistId, exact.start);
    const target = minutes(st.wantHm);
    const near = [...slots].sort((a, b) => Math.abs(minutes(a.hm) - target) - Math.abs(minutes(b.hm) - target)).slice(0, 10).sort((a, b) => a.hm.localeCompare(b.hm));
    return sendSlotList(ctx, ymd, near, `A las *${st.wantHm}* no me queda hora el ${longDayLabel(ymd)}. Lo más cercano 👇`);
  }
  if (st.wantRange) {
    const r = st.wantRange as Range;
    const inR = slots.filter((s) => inRange(s.hm, r));
    await ctx.setState({ wantRange: undefined });
    if (inR.length) return sendSlotList(ctx, ymd, inR.slice(0, 10), `Horarios en la *${RANGE_LABEL[r]}* del ${longDayLabel(ymd)} 👇`);
    await ctx.send(wa.text(`En la ${RANGE_LABEL[r]} del ${longDayLabel(ymd)} ya no quedan horas. Te muestro todo ese día:`));
  }
  return showSlots(ctx, ymd, 0);
}

async function sendSlotList(ctx: Ctx, ymd: string, slots: { dentistId: string; dentistName: string; start: string; hm: string }[], body: string) {
  await ctx.setState({ ymd, step: "slot" });
  return ctx.send(
    wa.list(body, "Elegir horario", [
      { title: "Horarios", rows: slots.slice(0, 10).map((s) => ({ id: `slot:${s.dentistId}:${s.start}`, title: `${s.hm} hrs`, description: `con ${s.dentistName}` })) },
    ], { header: "Agendar hora", footer: "Toca un horario o dímelo en un audio 🎤" })
  );
}

/* ════════════════════════════════════════════════════════════════════
   Agente IA con herramientas (tool calling)
   ════════════════════════════════════════════════════════════════════ */
async function agentReply(ctx: Ctx, isNew: boolean) {
  const c = ctx.clinic;
  const tz = c.timezone;
  const now = new Date();
  const services = await listServices(c.id);

  const { data: hist } = await db()
    .from("messages")
    .select("direction, body, author")
    .eq("conversation_id", ctx.conv.id)
    .order("created_at", { ascending: false })
    .limit(16);
  const history: ChatMsg[] = (hist ?? [])
    .reverse()
    .filter((m: any) => m.body)
    .map((m: any) => (m.direction === "in" ? { role: "user", content: m.body } : { role: "assistant", content: m.body }));

  let interactiveSent = false;
  const sent = async (p: any) => {
    interactiveSent = true;
    await ctx.send(p, "ai");
    return { ok: true, nota: "Ya se mostró al paciente un mensaje con botones/lista. No repitas las opciones; responde con texto vacío o una frase muy breve." };
  };

  const tools: ToolDef[] = [
    {
      name: "mostrar_menu",
      description: "Muestra el menú principal con botones (agendar, mis citas, precios, ubicación, recepción).",
      parameters: { type: "object", properties: {} },
      run: async () => { await sendMenu(ctx, false); interactiveSent = true; return { ok: true }; },
    },
    {
      name: "mostrar_servicios",
      description: "Envía al paciente la lista interactiva de servicios para que elija uno y comience a agendar.",
      parameters: { type: "object", properties: {} },
      run: async () => { await showServices(ctx); interactiveSent = true; return { ok: true, nota: "lista enviada" }; },
    },
    {
      name: "consultar_dias_disponibles",
      description: "Devuelve los próximos días con horarios libres para un servicio.",
      parameters: { type: "object", properties: { service_id: { type: "string" } }, required: ["service_id"] },
      run: async ({ service_id }) => (await getAvailableDays(c, { serviceId: service_id, limit: 10 })).map((d) => ({ fecha: d.ymd, etiqueta: longDayLabel(d.ymd), horarios_libres: d.count })),
    },
    {
      name: "mostrar_dias",
      description: "Envía la lista interactiva de días disponibles para un servicio.",
      parameters: { type: "object", properties: { service_id: { type: "string" } }, required: ["service_id"] },
      run: async ({ service_id }) => { await showDays(ctx, service_id); interactiveSent = true; return { ok: true }; },
    },
    {
      name: "consultar_horarios",
      description: "Devuelve horarios libres (hora local) de una fecha YYYY-MM-DD para un servicio.",
      parameters: { type: "object", properties: { service_id: { type: "string" }, fecha: { type: "string", description: "YYYY-MM-DD" } }, required: ["service_id", "fecha"] },
      run: async ({ service_id, fecha }) =>
        (await getSlots(c, { serviceId: service_id, ymd: fecha, collapse: true })).slice(0, 24).map((s) => ({ hora: s.hm, profesional: s.dentistName, dentist_id: s.dentistId, start_iso: s.start })),
    },
    {
      name: "mostrar_horarios",
      description: "Envía la lista interactiva de horarios de una fecha para que el paciente elija.",
      parameters: { type: "object", properties: { service_id: { type: "string" }, fecha: { type: "string" } }, required: ["service_id", "fecha"] },
      run: async ({ service_id, fecha }) => { await ctx.setState({ serviceId: service_id }); await showSlots(ctx, fecha, 0); interactiveSent = true; return { ok: true }; },
    },
    {
      name: "preparar_reserva",
      description: "Cuando el paciente ya eligió servicio y horario exacto (de consultar_horarios): guarda su nombre y le envía botones para CONFIRMAR. Nunca confirmes una reserva sin esta herramienta.",
      parameters: {
        type: "object",
        properties: {
          service_id: { type: "string" },
          dentist_id: { type: "string" },
          start_iso: { type: "string" },
          nombre_paciente: { type: "string", description: "Nombre y apellido si el paciente lo indicó" },
        },
        required: ["service_id", "dentist_id", "start_iso"],
      },
      run: async ({ service_id, dentist_id, start_iso, nombre_paciente }) => {
        if (nombre_paciente && nombre_paciente.length >= 3) {
          ctx.patient = await upsertPatient(c.id, ctx.to, { full_name: titleCase(nombre_paciente) });
        }
        await ctx.setState({ serviceId: service_id });
        await pickSlot(ctx, dentist_id, new Date(start_iso).toISOString());
        interactiveSent = true;
        return { ok: true, nota: ctx.patient?.full_name ? "Se enviaron botones de confirmación" : "Se pidió el nombre al paciente" };
      },
    },
    {
      name: "mis_citas",
      description: "Muestra al paciente sus próximas citas con botones para confirmar, reagendar o cancelar.",
      parameters: { type: "object", properties: {} },
      run: async () => { await showMine(ctx); interactiveSent = true; return { ok: true }; },
    },
    {
      name: "info_consultorio",
      description: "Envía dirección, horarios y botón de Google Maps.",
      parameters: { type: "object", properties: {} },
      run: async () => { await showInfo(ctx); interactiveSent = true; return { ok: true }; },
    },
    {
      name: "enlace_reserva_web",
      description: "Envía un botón con el enlace a la agenda online del consultorio.",
      parameters: { type: "object", properties: {} },
      run: async () => sent(wa.cta("Reserva online con todos los horarios a la vista 👇", "Reservar online", `${APP_URL()}/reservar/${c.slug}`)),
    },
    {
      name: "derivar_a_recepcion",
      description: "Deriva la conversación a una persona del equipo (urgencias, reclamos, preguntas clínicas, pagos, convenios o si el paciente lo pide).",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"] },
      run: async ({ motivo }) => { await handoff(ctx, motivo); interactiveSent = true; return { ok: true }; },
    },
  ];

  const system = `Eres ${c.bot_name}, asistente virtual por WhatsApp de "${c.name}", un consultorio odontológico en ${c.city || "Chile"}.
Hoy es ${longDayLabel(ymdInTz(now, tz))} y son las ${hmInTz(now, tz)} (zona ${tz}).
Paciente: ${ctx.patient?.full_name || "(nombre aún desconocido)"} — teléfono ${ctx.to}.

DATOS DEL CONSULTORIO
- Dirección: ${c.address || "no informada"} ${c.city || ""}
- Horario: ${c.hours_text || "no informado"}
- Teléfono: ${c.phone || "no informado"}
- Descripción: ${c.about || "-"}
SERVICIOS (id · nombre · duración · precio):
${services.map((s: any) => `- ${s.id} · ${s.name} · ${s.duration_min} min · ${money(s.price)}`).join("\n") || "- (sin servicios)"}

REGLAS
1. Escribe en español de Chile, cálido y MUY breve (máx. 2-3 frases, estilo WhatsApp). Emojis con moderación.
2. Prefiere SIEMPRE las herramientas "mostrar_*" que envían botones y listas nativas: son más fáciles para el paciente.
3. Nunca inventes disponibilidad, precios ni datos. Usa las herramientas.
4. Si el paciente pide un día u hora concreta ("mañana a las 10"), usa consultar_horarios; si existe ese horario, llama preparar_reserva; si no, ofrece las alternativas más cercanas con mostrar_horarios.
5. Nunca des diagnósticos ni indicaciones médicas. Ante dolor intenso, sangrado, hinchazón o trauma: recomienda atención prioritaria y usa derivar_a_recepcion.
6. Si una herramienta ya envió botones/lista, responde con texto vacío o una frase corta; no repitas las opciones.
7. No hables de temas ajenos al consultorio.
${c.bot_instructions ? `\nINSTRUCCIONES DEL CONSULTORIO\n${c.bot_instructions}` : ""}`;

  if (isNew && !history.length) history.push({ role: "user", content: "Hola" });
  const reply = await runAgent({ system, history, tools });
  if (reply) await ctx.send(wa.text(reply), "ai");
  else if (!interactiveSent) await sendMenu(ctx, isNew);
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

/* ════════════════════════════════════════════════════════════════════
   Recordatorios (cron diario + botón manual en el panel)
   ════════════════════════════════════════════════════════════════════ */
export async function sendRemindersForClinic(clinic: any, acc: WaAccount, opts: { force?: boolean } = {}) {
  const tz = clinic.timezone;
  const tomorrow = ymdInTz(new Date(Date.now() + 24 * 3600 * 1000), tz);
  const { zonedToUtc, addDaysYmd } = await import("./time.ts");
  const from = zonedToUtc(tomorrow, "00:00", tz).toISOString();
  const to = zonedToUtc(addDaysYmd(tomorrow, 1), "00:00", tz).toISOString();

  let q = db()
    .from("appointments")
    .select("id, starts_at, status, patient:patients(full_name, phone), dentist:dentists(name), service:services(name)")
    .eq("clinic_id", clinic.id)
    .in("status", ["pending", "confirmed"])
    .gte("starts_at", from)
    .lt("starts_at", to);
  if (!opts.force) q = q.is("reminder_sent_at", null);
  const { data: appts } = await q;

  let sent = 0, failed = 0;
  for (const a of (appts ?? []) as any[]) {
    const phone = a.patient?.phone;
    if (!phone) continue;
    let { data: conv } = await db().from("conversations").select("id").eq("clinic_id", clinic.id).eq("wa_id", phone).maybeSingle();
    if (!conv) {
      ({ data: conv } = await db().from("conversations").insert({ clinic_id: clinic.id, wa_id: phone, profile_name: a.patient?.full_name }).select("id").single());
    }
    const when = humanDateTime(a.starts_at, tz);
    let r: { ok: boolean; error?: string };
    if (clinic.reminder_template) {
      // Plantilla aprobada (funciona fuera de la ventana de 24 h).
      // Cuerpo esperado: {{1}} nombre, {{2}} fecha/hora, {{3}} consultorio. Botones rápidos: Confirmo / Cancelar
      r = await sendWa(acc, phone, wa.template(clinic.reminder_template, clinic.reminder_template_lang || "es", [
        { type: "body", parameters: [
          { type: "text", text: a.patient?.full_name?.split(" ")[0] || "paciente" },
          { type: "text", text: when },
          { type: "text", text: clinic.name },
        ] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `aok:${a.id}` }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `acx:${a.id}` }] },
      ]), { conversationId: conv!.id, author: "system" });
    } else {
      // Mensaje interactivo (solo llega si el paciente escribió en las últimas 24 h)
      r = await sendWa(acc, phone, wa.buttons(
        `⏰ *Recordatorio de tu hora*\n\nHola ${a.patient?.full_name?.split(" ")[0] ?? ""}, te esperamos mañana:\n🦷 ${a.service?.name ?? "Atención"}\n👩‍⚕️ ${a.dentist?.name}\n📅 ${when}\n\n¿Nos confirmas tu asistencia?`,
        [{ id: `aok:${a.id}`, title: "✅ Confirmo" }, { id: `arb:${a.id}`, title: "🔄 Reagendar" }, { id: `acx:${a.id}`, title: "❌ Cancelar" }],
        { footer: clinic.name }
      ), { conversationId: conv!.id, author: "system" });
    }
    if (r.ok) {
      sent++;
      await db().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", a.id);
    } else failed++;
  }
  return { total: appts?.length ?? 0, sent, failed };
}
