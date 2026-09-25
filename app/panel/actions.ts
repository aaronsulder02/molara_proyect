"use server";
import { revalidatePath } from "next/cache";
import { db, authClient } from "@/lib/supabase";
import { requireAdmin, requireContext } from "@/lib/session";
import { bookAppointment, normalizePhone, setAppointmentStatus, upsertPatient } from "@/lib/booking";
import { zonedToUtc } from "@/lib/time.ts";
import { getAccountByClinic, sendWa, wa } from "@/lib/whatsapp";
import { runSetup, removeOverride, type Step } from "@/lib/metaConnect";
import { sendRemindersForClinic } from "@/lib/bot";
import { igProfile } from "@/lib/instagram";

type S = { error?: string; ok?: string; data?: any } | undefined;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const fail = (e: any): S => ({ error: e?.message || String(e) });

/* ═══════════════════════ CITAS ═══════════════════════ */
export async function createAppointment(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireContext();
    const phone = normalizePhone(str(fd, "phone"));
    if (phone.length < 10) return { error: "Ingresa el celular del paciente (ej: +56 9 1234 5678)." };
    const date = str(fd, "date");
    const time = str(fd, "time");
    if (!date || !time) return { error: "Selecciona fecha y hora." };
    const start = zonedToUtc(date, time, clinic.timezone);
    const force = fd.get("force") === "on";
    const res = await bookAppointment({
      clinic,
      serviceId: str(fd, "service_id"),
      dentistId: str(fd, "dentist_id") || null,
      startISO: start.toISOString(),
      patient: { phone, full_name: str(fd, "name") || null, email: str(fd, "email") || null },
      channel: "panel",
      notes: str(fd, "notes") || null,
      status: fd.get("confirmed") === "on" ? "confirmed" : "pending",
      force,
    });
    if (!res.ok) return { error: res.error + (force ? "" : " (Puedes marcar “Forzar fuera de horario” si corresponde.)") };
    revalidatePath("/panel", "layout");
    return { ok: "Cita creada ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function changeAppointmentStatus(fd: FormData) {
  const { clinic } = await requireContext();
  await setAppointmentStatus(clinic.id, str(fd, "id"), str(fd, "status"));
  revalidatePath("/panel", "layout");
}

export async function updateAppointmentNotes(fd: FormData) {
  const { clinic } = await requireContext();
  await db().from("appointments").update({ notes: str(fd, "notes") || null }).eq("clinic_id", clinic.id).eq("id", str(fd, "id"));
  revalidatePath("/panel/citas");
}

export async function runReminders(_: S): Promise<S> {
  try {
    const { clinic } = await requireContext();
    const acc = await getAccountByClinic(clinic.id);
    if (!acc) return { error: "Primero conecta tu número de WhatsApp." };
    const r = await sendRemindersForClinic(clinic, acc, { force: true });
    revalidatePath("/panel", "layout");
    return r.total
      ? { ok: `Recordatorios para mañana: ${r.sent} enviados, ${r.failed} fallidos de ${r.total}.${r.failed ? " Los fallidos requieren una plantilla aprobada (ventana de 24 h cerrada)." : ""}` }
      : { ok: "No hay citas para mañana." };
  } catch (e) {
    return fail(e);
  }
}

/* ═══════════════════════ PACIENTES ═══════════════════════ */
export async function savePatient(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireContext();
    const id = str(fd, "id");
    const row = {
      full_name: str(fd, "full_name") || null,
      phone: normalizePhone(str(fd, "phone")),
      email: str(fd, "email") || null,
      rut: str(fd, "rut") || null,
      notes: str(fd, "notes") || null,
    };
    if (row.phone.length < 10) return { error: "Teléfono inválido." };
    if (id) {
      const { error } = await db().from("patients").update(row).eq("clinic_id", clinic.id).eq("id", id);
      if (error) return { error: error.code === "23505" ? "Ya existe un paciente con ese teléfono." : error.message };
    } else {
      const { error } = await db().from("patients").insert({ ...row, clinic_id: clinic.id });
      if (error) return { error: error.code === "23505" ? "Ya existe un paciente con ese teléfono." : error.message };
    }
    revalidatePath("/panel/pacientes");
    return { ok: "Paciente guardado ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePatient(fd: FormData) {
  const { clinic } = await requireAdmin();
  await db().from("patients").delete().eq("clinic_id", clinic.id).eq("id", str(fd, "id"));
  revalidatePath("/panel/pacientes");
}

/* ═══════════════════════ SERVICIOS ═══════════════════════ */
export async function saveService(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const id = str(fd, "id");
    const row = {
      name: str(fd, "name"),
      description: str(fd, "description") || null,
      duration_min: Number(str(fd, "duration_min")) || 30,
      price: str(fd, "price") ? Number(str(fd, "price").replace(/\D/g, "")) : null,
      active: fd.get("active") !== "off",
    };
    if (row.name.length < 2) return { error: "Nombre requerido." };
    const q = id
      ? db().from("services").update(row).eq("clinic_id", clinic.id).eq("id", id)
      : db().from("services").insert({ ...row, clinic_id: clinic.id, sort: 99 });
    const { error } = await q;
    if (error) return { error: error.message };
    revalidatePath("/panel/servicios");
    return { ok: "Servicio guardado ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleService(fd: FormData) {
  const { clinic } = await requireAdmin();
  await db().from("services").update({ active: str(fd, "active") === "true" }).eq("clinic_id", clinic.id).eq("id", str(fd, "id"));
  revalidatePath("/panel/servicios");
}

/* ═══════════════════════ PROFESIONALES + HORARIOS ═══════════════════════ */
export async function saveDentist(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const id = str(fd, "id");
    const row = { name: str(fd, "name"), specialty: str(fd, "specialty") || null, color: str(fd, "color") || "#0E9F8E" };
    if (row.name.length < 3) return { error: "Nombre requerido." };
    if (id) await db().from("dentists").update(row).eq("clinic_id", clinic.id).eq("id", id);
    else {
      const { data: d, error } = await db().from("dentists").insert({ ...row, clinic_id: clinic.id }).select("id").single();
      if (error) return { error: error.message };
      // horario base L-V
      await db().from("schedules").insert(
        [1, 2, 3, 4, 5].map((wd) => ({ clinic_id: clinic.id, dentist_id: d.id, weekday: wd, start_time: "09:00", end_time: "18:00" }))
      );
    }
    revalidatePath("/panel/servicios");
    return { ok: "Profesional guardado ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleDentist(fd: FormData) {
  const { clinic } = await requireAdmin();
  await db().from("dentists").update({ active: str(fd, "active") === "true" }).eq("clinic_id", clinic.id).eq("id", str(fd, "id"));
  revalidatePath("/panel/servicios");
}

/** Cada día recibe rangos tipo "09:00-13:00, 14:30-19:00" */
export async function saveSchedule(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const dentistId = str(fd, "dentist_id");
    const rows: any[] = [];
    for (let wd = 0; wd < 7; wd++) {
      const raw = str(fd, `d${wd}`);
      if (!raw) continue;
      for (const part of raw.split(/[,;]+/)) {
        const m = part.trim().match(/^(\d{1,2}):?(\d{2})?\s*[-–a]\s*(\d{1,2}):?(\d{2})?$/i);
        if (!m) return { error: `Formato inválido en ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][wd]}: “${part.trim()}”. Usa 09:00-13:00` };
        const s = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
        const e = `${m[3].padStart(2, "0")}:${m[4] ?? "00"}`;
        if (e <= s) return { error: `El término debe ser posterior al inicio (${part.trim()}).` };
        rows.push({ clinic_id: clinic.id, dentist_id: dentistId, weekday: wd, start_time: s, end_time: e });
      }
    }
    await db().from("schedules").delete().eq("clinic_id", clinic.id).eq("dentist_id", dentistId);
    if (rows.length) {
      const { error } = await db().from("schedules").insert(rows);
      if (error) return { error: error.message };
    }
    revalidatePath("/panel/servicios");
    return { ok: "Horario actualizado ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function addBlock(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireContext();
    const from = zonedToUtc(str(fd, "from_date"), str(fd, "from_time") || "00:00", clinic.timezone);
    const to = zonedToUtc(str(fd, "to_date") || str(fd, "from_date"), str(fd, "to_time") || "23:59", clinic.timezone);
    if (to <= from) return { error: "El término debe ser posterior al inicio." };
    const { error } = await db().from("blocked_times").insert({
      clinic_id: clinic.id,
      dentist_id: str(fd, "dentist_id") || null,
      starts_at: from.toISOString(),
      ends_at: to.toISOString(),
      reason: str(fd, "reason") || null,
    });
    if (error) return { error: error.message };
    revalidatePath("/panel/servicios");
    return { ok: "Bloqueo agregado ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBlock(fd: FormData) {
  const { clinic } = await requireContext();
  await db().from("blocked_times").delete().eq("clinic_id", clinic.id).eq("id", str(fd, "id"));
  revalidatePath("/panel/servicios");
}

/* ═══════════════════════ USUARIOS ═══════════════════════ */
export async function createMember(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const email = str(fd, "email").toLowerCase();
    const password = str(fd, "password");
    const full_name = str(fd, "full_name");
    const role = (["admin", "staff"].includes(str(fd, "role")) ? str(fd, "role") : "staff") as "admin" | "staff";
    if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Correo inválido." };
    if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };

    let userId: string | null = null;
    const { data, error } = await db().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
    if (error) {
      if (!error.message.toLowerCase().includes("already")) return { error: error.message };
      return { error: "Ese correo ya tiene cuenta en Molara. Usa otro correo." };
    }
    userId = data.user!.id;
    const { error: mErr } = await db().from("clinic_members").insert({ clinic_id: clinic.id, user_id: userId, role, full_name, email });
    if (mErr) return { error: mErr.message };
    revalidatePath("/panel/usuarios");
    return { ok: `Usuario creado. Comparte con ${full_name || email} su correo y contraseña.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateMemberRole(fd: FormData) {
  const { clinic, user } = await requireAdmin();
  const uid = str(fd, "user_id");
  if (uid === user.id) return;
  const role = str(fd, "role");
  if (!["admin", "staff"].includes(role)) return;
  await db().from("clinic_members").update({ role }).eq("clinic_id", clinic.id).eq("user_id", uid).neq("role", "owner");
  revalidatePath("/panel/usuarios");
}

export async function removeMember(fd: FormData) {
  const { clinic, user } = await requireAdmin();
  const uid = str(fd, "user_id");
  if (uid === user.id) return;
  const { data: m } = await db().from("clinic_members").select("role").eq("clinic_id", clinic.id).eq("user_id", uid).maybeSingle();
  if (!m || m.role === "owner") return;
  await db().from("clinic_members").delete().eq("clinic_id", clinic.id).eq("user_id", uid);
  const { count } = await db().from("clinic_members").select("*", { count: "exact", head: true }).eq("user_id", uid);
  if (!count) await db().auth.admin.deleteUser(uid).catch(() => null);
  revalidatePath("/panel/usuarios");
}

export async function changePassword(_: S, fd: FormData): Promise<S> {
  try {
    const { user } = await requireContext();
    const current = str(fd, "current");
    const next = str(fd, "next");
    if (next.length < 8) return { error: "La nueva contraseña debe tener al menos 8 caracteres." };
    const { error: e1 } = await authClient().auth.signInWithPassword({ email: user.email, password: current });
    if (e1) return { error: "La contraseña actual no es correcta." };
    const { error } = await db().auth.admin.updateUserById(user.id, { password: next });
    if (error) return { error: error.message };
    return { ok: "Contraseña actualizada ✔" };
  } catch (e) {
    return fail(e);
  }
}

/* ═══════════════════════ AJUSTES ═══════════════════════ */
export async function saveClinic(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const slug = str(fd, "slug").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (slug.length < 3) return { error: "El link debe tener al menos 3 caracteres." };
    const patch: any = {
      name: str(fd, "name"),
      slug,
      phone: str(fd, "phone") || null,
      email: str(fd, "email") || null,
      address: str(fd, "address") || null,
      city: str(fd, "city") || null,
      about: str(fd, "about") || null,
      hours_text: str(fd, "hours_text") || null,
      slot_minutes: Number(str(fd, "slot_minutes")) || 15,
      min_notice_min: Number(str(fd, "min_notice_min")) || 0,
      booking_window_days: Number(str(fd, "booking_window_days")) || 30,
    };
    const { error } = await db().from("clinics").update(patch).eq("id", clinic.id);
    if (error) return { error: error.code === "23505" ? "Ese link ya está en uso, prueba otro." : error.message };
    revalidatePath("/panel", "layout");
    return { ok: "Datos del consultorio guardados ✔" };
  } catch (e) {
    return fail(e);
  }
}

export async function saveBot(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const { error } = await db()
      .from("clinics")
      .update({
        bot_name: str(fd, "bot_name") || "Sofía",
        bot_welcome: str(fd, "bot_welcome") || null,
        bot_instructions: str(fd, "bot_instructions") || "",
        ai_enabled: fd.get("ai_enabled") === "on",
        reminder_template: str(fd, "reminder_template") || null,
        reminder_template_lang: str(fd, "reminder_template_lang") || "es",
      })
      .eq("id", clinic.id);
    if (error) return { error: error.message };
    revalidatePath("/panel", "layout");
    return { ok: "Asistente actualizado ✔" };
  } catch (e) {
    return fail(e);
  }
}

/* ═══════════════════════ WHATSAPP ═══════════════════════ */
const summarize = (steps: Step[]) => steps.filter((x) => x.state === "warn").map((x) => x.detail).join(" ");

export async function connectWhatsapp(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const useDemo = fd.get("use_demo") === "on";
    const env = process.env;
    const phoneNumberId = useDemo ? env.BUSINESS_PHONE || "" : str(fd, "phone_number_id");
    const wabaId = useDemo ? env.WABA_ID || "" : str(fd, "waba_id");
    let token = useDemo ? env.WHATSAPP_ACCESS_TOKEN || "" : str(fd, "access_token");
    const appId = useDemo ? env.META_APP_ID || "" : str(fd, "app_id");
    let appSecret = useDemo ? env.META_APP_SECRET || "" : str(fd, "app_secret");

    // Campos secretos vacíos = mantener los guardados (si es el mismo número)
    const existing = await getAccountByClinic(clinic.id);
    if (existing && existing.phone_number_id === phoneNumberId) {
      if (!token) token = existing.access_token;
      if (!appSecret && existing.app_id === appId) appSecret = existing.app_secret || "";
    }
    if (useDemo && (!phoneNumberId || !wabaId || !token || !appId || !appSecret))
      return { error: "Faltan variables del número de ejemplo en el servidor (BUSINESS_PHONE, WABA_ID, WHATSAPP_ACCESS_TOKEN, META_APP_ID, META_APP_SECRET)." };
    if (!/^\d{6,}$/.test(phoneNumberId)) return { error: "El Phone Number ID debe ser numérico (Meta → WhatsApp → Configuración de la API)." };
    if (!/^\d{6,}$/.test(wabaId)) return { error: "El WhatsApp Business Account ID debe ser numérico." };
    if (!/^\d{6,}$/.test(appId)) return { error: "El App ID debe ser numérico (Meta for Developers → tu app → Configuración de la app → Básica)." };
    if (!/^[0-9a-f]{32}$/i.test(appSecret)) return { error: "El App Secret debe tener 32 caracteres (Configuración de la app → Básica → Clave secreta de la app → Mostrar)." };
    if (!token) return { error: "Falta el token de acceso." };

    const { data: other } = await db().from("whatsapp_accounts").select("clinic_id").eq("phone_number_id", phoneNumberId).maybeSingle();
    if (other && other.clinic_id !== clinic.id) return { error: "Ese número ya está conectado a otro consultorio en Molara." };

    const r = await runSetup(clinic.id, { phoneNumberId, wabaId, token, appId, appSecret });
    revalidatePath("/panel", "layout");
    if (!r.ok) return { error: r.error };
    const who = `${r.info.verified_name} (${r.info.display_phone_number})`;
    if (r.status === "active") {
      const w = summarize(r.steps);
      return { ok: `¡Listo! ${who} quedó conectado y Molara configuró el webhook en Meta automáticamente ✔${w ? ` Aviso: ${w}` : ""}` };
    }
    if (r.status === "pending") return { ok: `${who} quedó conectado ✔ El webhook se activará automáticamente al publicar la plataforma en internet.` };
    return { error: `${who} quedó guardado, pero Meta no aceptó el webhook: ${r.error} Puedes reintentar con “Reconfigurar webhook”.` };
  } catch (e) {
    return fail(e);
  }
}

/** Vuelve a ejecutar la conexión automática con las credenciales guardadas. */
export async function reconfigureWebhook(_: S, fd: FormData): Promise<S> {
  void fd;
  try {
    const { clinic } = await requireAdmin();
    const acc = await getAccountByClinic(clinic.id);
    if (!acc) return { error: "Conecta primero tu número." };
    if (!acc.app_id || !acc.app_secret) return { error: "Faltan el App ID y el App Secret. Complétalos en el formulario y presiona “Actualizar y verificar”." };
    const r = await runSetup(clinic.id, { phoneNumberId: acc.phone_number_id, wabaId: acc.waba_id, token: acc.access_token, appId: acc.app_id, appSecret: acc.app_secret });
    revalidatePath("/panel", "layout");
    if (!r.ok) return { error: r.error };
    if (r.status === "active") return { ok: "Webhook verificado y activo en Meta ✔" };
    if (r.status === "pending") return { ok: "Credenciales correctas. El webhook se activará al publicar la plataforma en internet." };
    return { error: r.error || "Meta no aceptó el webhook." };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectWhatsapp(fd: FormData) {
  const { clinic } = await requireAdmin();
  void fd;
  const acc = await getAccountByClinic(clinic.id);
  if (acc) {
    try { await removeOverride(acc.waba_id, acc.access_token); } catch {}
  }
  await db().from("whatsapp_accounts").delete().eq("clinic_id", clinic.id);
  revalidatePath("/panel", "layout");
}

export async function sendTestMessage(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireContext();
    const acc = await getAccountByClinic(clinic.id);
    if (!acc) return { error: "Conecta primero tu número." };
    const to = normalizePhone(str(fd, "to"));
    const mode = str(fd, "mode");
    // Plantilla hello_world (existe por defecto en toda WABA) para abrir conversación
    const payload =
      mode === "template"
        ? wa.template("hello_world", "en_US")
        : wa.buttons(`¡Hola! 👋 Este es un mensaje de prueba de *${clinic.name}* enviado desde Molara.`, [
            { id: "book", title: "📅 Agendar hora" },
            { id: "menu", title: "Ver menú" },
          ]);
    let { data: conv } = await db().from("conversations").select("id").eq("clinic_id", clinic.id).eq("wa_id", to).maybeSingle();
    if (!conv) ({ data: conv } = await db().from("conversations").insert({ clinic_id: clinic.id, wa_id: to }).select("id").single());
    const r = await sendWa(acc, to, payload, { conversationId: conv!.id, author: "staff" });
    revalidatePath("/panel/conversaciones");
    return r.ok
      ? { ok: "Mensaje enviado ✔ Revisa el WhatsApp de destino." }
      : { error: `Meta respondió: ${r.error}. ${mode !== "template" ? "Si el número nunca te escribió, usa la plantilla hello_world." : "En números de prueba, agrega el destino como destinatario autorizado en Meta."}` };
  } catch (e) {
    return fail(e);
  }
}

/* ═══════════════════════ CONVERSACIONES ═══════════════════════ */
export async function setConversationMode(fd: FormData) {
  const { clinic } = await requireContext();
  await db().from("conversations").update({ mode: str(fd, "mode") === "human" ? "human" : "bot", state: {} }).eq("clinic_id", clinic.id).eq("id", str(fd, "id"));
  revalidatePath("/panel/conversaciones");
}

export async function sendManualReply(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic, memberName } = await requireContext();
    const id = str(fd, "id");
    const text = str(fd, "text");
    if (!text) return { error: "Escribe un mensaje." };
    const { data: conv } = await db().from("conversations").select("*").eq("clinic_id", clinic.id).eq("id", id).single();
    const acc = await getAccountByClinic(clinic.id);
    if (!acc || !conv) return { error: "WhatsApp no conectado." };
    const r = await sendWa(acc, conv.wa_id, wa.text(text), { conversationId: conv.id, author: "staff" });
    // Al responder una persona, el bot se pausa para no interrumpir
    await db().from("conversations").update({ mode: "human", unread: 0 }).eq("id", conv.id);
    revalidatePath("/panel/conversaciones");
    void memberName;
    return r.ok ? { ok: "Enviado" } : { error: `No se pudo enviar: ${r.error}. Si pasaron más de 24 h desde el último mensaje del paciente, Meta exige plantilla.` };
  } catch (e) {
    return fail(e);
  }
}

/* ═══════════════════════ INSTAGRAM ═══════════════════════ */
export async function connectInstagram(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const acc = {
      ig_user_id: str(fd, "ig_user_id"),
      access_token: str(fd, "access_token"),
      api_host: str(fd, "api_host") === "graph.instagram.com" ? "graph.instagram.com" : "graph.facebook.com",
    };
    if (!acc.ig_user_id || !acc.access_token) return { error: "Completa el ID de la cuenta y el token." };
    let profile;
    try {
      profile = await igProfile(acc);
    } catch (e: any) {
      return { error: `Instagram rechazó las credenciales: ${e.message}` };
    }
    const { error } = await db().from("instagram_accounts").upsert({ clinic_id: clinic.id, ...acc, username: profile.username }, { onConflict: "clinic_id" });
    if (error) return { error: error.message };
    revalidatePath("/panel/instagram");
    return { ok: `Conectado a @${profile.username} ✔` };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectInstagram(fd: FormData) {
  const { clinic } = await requireAdmin();
  void fd;
  await db().from("instagram_accounts").delete().eq("clinic_id", clinic.id);
  revalidatePath("/panel/instagram");
}

export async function quickPatient(phone: string, name: string) {
  const { clinic } = await requireContext();
  return upsertPatient(clinic.id, phone, { full_name: name });
}
