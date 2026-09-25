// Motor de disponibilidad (puro, sin I/O) — testeable de forma aislada.
import { minToHm, timeToMin, zonedToUtc } from "./time.ts";

export type SlotInput = {
  ymd: string;
  tz: string;
  durationMin: number;
  stepMin: number;
  dentists: { id: string; name: string }[];
  /** Bloques de atención del día de la semana correspondiente */
  schedules: { dentist_id: string; start_time: string; end_time: string }[];
  /** Citas activas y bloqueos. dentist_id null = bloquea a todo el consultorio */
  busy: { dentist_id: string | null; start: Date; end: Date }[];
  now: Date;
  minNoticeMin: number;
  /** true: un único horario por hora (el primer profesional libre) */
  collapse?: boolean;
};

export type Slot = { dentistId: string; dentistName: string; start: string; end: string; hm: string };

export function computeSlots(inp: SlotInput): Slot[] {
  const out: Slot[] = [];
  const earliest = inp.now.getTime() + inp.minNoticeMin * 60000;
  const durMs = inp.durationMin * 60000;

  for (const dentist of inp.dentists) {
    const blocks = inp.schedules.filter((s) => s.dentist_id === dentist.id);
    const busy = inp.busy.filter((b) => b.dentist_id === null || b.dentist_id === dentist.id);
    for (const b of blocks) {
      const from = timeToMin(b.start_time);
      const to = timeToMin(b.end_time);
      for (let t = from; t + inp.durationMin <= to; t += inp.stepMin) {
        const start = zonedToUtc(inp.ymd, minToHm(t), inp.tz);
        const s = start.getTime();
        const e = s + durMs;
        if (s < earliest) continue;
        const clash = busy.some((x) => s < x.end.getTime() && e > x.start.getTime());
        if (clash) continue;
        out.push({
          dentistId: dentist.id,
          dentistName: dentist.name,
          start: start.toISOString(),
          end: new Date(e).toISOString(),
          hm: minToHm(t),
        });
      }
    }
  }

  out.sort((a, b) => a.start.localeCompare(b.start) || a.dentistName.localeCompare(b.dentistName));
  if (!inp.collapse) return out;
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)));
}
