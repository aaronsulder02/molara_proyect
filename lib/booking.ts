import { db } from "./supabase";
import { getService, getSlots, type Clinic } from "./availability";
import { ymdInTz } from "./time.ts";

/** Normaliza a E.164 sin '+'. Asume Chile (56) si viene un móvil local de 9 dígitos. */
export function normalizePhone(raw: string): string {
  let p = String(raw || "").replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.length === 9 && p.startsWith("9")) p = "56" + p;
  if (p.length === 8) p = "569" + p;
  return p;
}

/** Mismo celular aunque uno venga con código de país y el otro no (compara los últimos 8 dígitos). */
export function samePhone(a?: string | null, b?: string | null): boolean {
  const x = normalizePhone(a || ""), y = normalizePhone(b || "");
  if (x.length < 8 || y.length < 8) return false;
  return x === y || x.slice(-8) === y.slice(-8);
}

export async function upsertPatient(clinicId: string, phone: string, patch: { full_name?: string | null; email?: string | null; rut?: string | null }) {
  const clean = normalizePhone(phone);
  const { data: existing } = await db().from("patients").select("*").eq("clinic_id", clinicId).eq("phone", clean).maybeSingle();
  if (existing) {
    const upd: any = {};
    if (patch.full_name && !existing.full_name) upd.full_name = patch.full_name;
    if (patch.full_name && existing.full_name !== patch.full_name && patch.full_name.length > 2) upd.full_name = patch.full_name;
    if (patch.email) upd.email = patch.email;
    if (patch.rut) upd.rut = patch.rut;
    if (Object.keys(upd).length) {
      const { data } = await db().from("patients").update(upd).eq("id", existing.id).select("*").single();
      return data ?? existing;
    }
    return existing;
  }
  const { data, error } = await db()
    .from("patients")
    .insert({ clinic_id: clinicId, phone: clean, full_name: patch.full_name ?? null, email: patch.email ?? null, rut: patch.rut ?? null })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export type BookInput = {
  clinic: Clinic;
  serviceId: string;
  startISO: string;
  dentistId?: string | null; // null => primer profesional libre
  patient: { phone: string; full_name?: string | null; email?: string | null; rut?: string | null };
  channel: "whatsapp" | "web" | "panel";
  notes?: string | null;
  status?: "pending" | "confirmed";
  /** Omite la validación contra horarios de atención (reservas manuales desde el panel) */
  force?: boolean;
  /** Cita que se está reagendando: no cuenta como cruce con la nueva hora */
  replacingId?: string | null;
};

export type BookResult = { ok: boolean; appointment?: any; error?: string };

export async function bookAppointment(inp: BookInput): Promise<BookResult> {
  const service = await getService(inp.clinic.id, inp.serviceId);
  if (!service) return { ok: false, error: "El servicio no existe." };
  const start = new Date(inp.startISO);
  if (isNaN(start.getTime())) return { ok: false, error: "Fecha inválida." };
  const end = new Date(start.getTime() + service.duration_min * 60000);

  let dentistId = inp.dentistId || null;
  if (!inp.force) {
    const ymd = ymdInTz(start, inp.clinic.timezone);
    const slots = await getSlots(inp.clinic, { serviceId: service.id, ymd, dentistId });
    const match = slots.find((s) => s.start === start.toISOString());
    if (!match) return { ok: false, error: "Ese horario ya no está disponible. Elige otro, por favor." };
    dentistId = match.dentistId;
  }
  if (!dentistId) return { ok: false, error: "Selecciona un profesional." };

  const patient = await upsertPatient(inp.clinic.id, inp.patient.phone, inp.patient);

  // Un mismo paciente no puede tener dos horas que se crucen (aunque sean con profesionales distintos)
  const { data: clash } = await db()
    .from("appointments")
    .select("id")
    .eq("clinic_id", inp.clinic.id)
    .eq("patient_id", patient.id)
    .in("status", ["pending", "confirmed"])
    .lt("starts_at", end.toISOString())
    .gt("ends_at", start.toISOString())
    .limit(2);
  if (!inp.force && clash?.some((c: any) => c.id !== inp.replacingId)) return { ok: false, error: "Ya tienes una hora reservada que se cruza con ese horario. Revisa tus citas o elige otro horario." };

  const { data, error } = await db()
    .from("appointments")
    .insert({
      clinic_id: inp.clinic.id,
      patient_id: patient.id,
      dentist_id: dentistId,
      service_id: service.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      channel: inp.channel,
      status: inp.status ?? "pending",
      notes: inp.notes ?? null,
      confirmed_at: inp.status === "confirmed" ? new Date().toISOString() : null,
    })
    .select("*, dentist:dentists(name), service:services(name, duration_min, price), patient:patients(full_name, phone)")
    .single();

  if (error) {
    if (error.code === "23P01") return { ok: false, error: "Ese horario acaba de ser tomado. Elige otro, por favor." };
    return { ok: false, error: error.message };
  }
  return { ok: true, appointment: data };
}

export async function setAppointmentStatus(clinicId: string, id: string, status: string) {
  const patch: any = { status };
  if (status === "confirmed") patch.confirmed_at = new Date().toISOString();
  if (status === "cancelled") patch.cancelled_at = new Date().toISOString();
  const { data, error } = await db()
    .from("appointments")
    .update(patch)
    .eq("clinic_id", clinicId)
    .eq("id", id)
    .select("*, dentist:dentists(name), service:services(name), patient:patients(full_name, phone)")
    .single();
  if (error) throw new Error(error.code === "23P01" ? "Ese horario ya está ocupado por otra cita." : error.message);
  return data;
}

export async function upcomingForPatient(clinicId: string, phone: string) {
  const { data: p } = await db().from("patients").select("id").eq("clinic_id", clinicId).eq("phone", normalizePhone(phone)).maybeSingle();
  if (!p) return [];
  const { data } = await db()
    .from("appointments")
    .select("id, starts_at, ends_at, status, service_id, dentist_id, dentist:dentists(name), service:services(name)")
    .eq("clinic_id", clinicId)
    .eq("patient_id", p.id)
    .in("status", ["pending", "confirmed"])
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(10);
  return data ?? [];
}
