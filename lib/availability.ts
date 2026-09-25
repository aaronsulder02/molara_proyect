import { db } from "./supabase";
import { computeSlots, type Slot } from "./slots.ts";
import { addDaysYmd, weekdayOfYmd, ymdInTz, zonedToUtc } from "./time.ts";

export type Clinic = {
  id: string;
  timezone: string;
  slot_minutes: number;
  min_notice_min: number;
  booking_window_days: number;
};

export async function getService(clinicId: string, serviceId: string) {
  const { data } = await db()
    .from("services")
    .select("id, name, duration_min, price, description")
    .eq("clinic_id", clinicId)
    .eq("id", serviceId)
    .maybeSingle();
  return data;
}

export async function listServices(clinicId: string) {
  const { data } = await db()
    .from("services")
    .select("id, name, duration_min, price, description")
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .order("sort")
    .order("name");
  return data ?? [];
}

/** Carga en 4 consultas todo lo necesario para calcular un rango de días. */
async function loadRange(clinic: Clinic, fromYmd: string, toYmdExclusive: string, dentistId?: string | null) {
  const tz = clinic.timezone || "America/Santiago";
  let dq = db().from("dentists").select("id, name").eq("clinic_id", clinic.id).eq("active", true);
  if (dentistId) dq = dq.eq("id", dentistId);
  const rangeStart = zonedToUtc(fromYmd, "00:00", tz).toISOString();
  const rangeEnd = zonedToUtc(toYmdExclusive, "00:00", tz).toISOString();

  const [{ data: dentists }, { data: schedules }, { data: appts }, { data: blocks }] = await Promise.all([
    dq,
    db().from("schedules").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", clinic.id),
    db()
      .from("appointments")
      .select("dentist_id, starts_at, ends_at")
      .eq("clinic_id", clinic.id)
      .in("status", ["pending", "confirmed"])
      .lt("starts_at", rangeEnd)
      .gt("ends_at", rangeStart),
    db()
      .from("blocked_times")
      .select("dentist_id, starts_at, ends_at")
      .eq("clinic_id", clinic.id)
      .lt("starts_at", rangeEnd)
      .gt("ends_at", rangeStart),
  ]);
  const busy = [...(appts ?? []), ...(blocks ?? [])].map((b: any) => ({
    dentist_id: b.dentist_id,
    start: new Date(b.starts_at),
    end: new Date(b.ends_at),
  }));
  return { tz, dentists: dentists ?? [], schedules: schedules ?? [], busy };
}

function slotsFor(clinic: Clinic, data: Awaited<ReturnType<typeof loadRange>>, ymd: string, durationMin: number, collapse?: boolean) {
  const wd = weekdayOfYmd(ymd);
  return computeSlots({
    ymd,
    tz: data.tz,
    durationMin,
    stepMin: clinic.slot_minutes || 15,
    dentists: data.dentists,
    schedules: data.schedules.filter((s: any) => s.weekday === wd),
    busy: data.busy,
    now: new Date(),
    minNoticeMin: clinic.min_notice_min ?? 60,
    collapse,
  });
}

/** Horarios libres de un día para un servicio (y opcionalmente un profesional). */
export async function getSlots(
  clinic: Clinic,
  opts: { serviceId: string; ymd: string; dentistId?: string | null; collapse?: boolean }
): Promise<Slot[]> {
  const service = await getService(clinic.id, opts.serviceId);
  if (!service) return [];
  const data = await loadRange(clinic, opts.ymd, addDaysYmd(opts.ymd, 1), opts.dentistId);
  if (!data.dentists.length) return [];
  return slotsFor(clinic, data, opts.ymd, service.duration_min, opts.collapse);
}

/** Próximos días con al menos un horario libre. */
export async function getAvailableDays(
  clinic: Clinic,
  opts: { serviceId: string; dentistId?: string | null; limit?: number }
): Promise<{ ymd: string; count: number }[]> {
  const service = await getService(clinic.id, opts.serviceId);
  if (!service) return [];
  const tz = clinic.timezone || "America/Santiago";
  const today = ymdInTz(new Date(), tz);
  const windowDays = Math.min(clinic.booking_window_days || 30, 60);
  const data = await loadRange(clinic, today, addDaysYmd(today, windowDays), opts.dentistId);
  if (!data.dentists.length) return [];

  const out: { ymd: string; count: number }[] = [];
  const limit = opts.limit ?? 10;
  for (let i = 0; i < windowDays && out.length < limit; i++) {
    const ymd = addDaysYmd(today, i);
    const n = slotsFor(clinic, data, ymd, service.duration_min, true).length;
    if (n) out.push({ ymd, count: n });
  }
  return out;
}
