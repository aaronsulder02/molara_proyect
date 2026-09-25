// Utilidades de fecha/hora con zona horaria sin librerías externas (Intl nativo).

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Componentes de fecha/hora "de pared" en la zona indicada. */
export function wallParts(d: Date, tz: string) {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value;
  return {
    y: +p.year,
    m: +p.month,
    d: +p.day,
    h: +p.hour,
    min: +p.minute,
    s: +p.second,
  };
}

/** Diferencia (minutos) entre la hora de pared en tz y UTC para un instante. */
export function tzOffsetMinutes(d: Date, tz: string): number {
  const w = wallParts(d, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Convierte "YYYY-MM-DD" + "HH:MM" en hora local de tz a Date (UTC). Maneja cambios de horario. */
export function zonedToUtc(ymd: string, hm: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(ts), tz);
  if (off2 !== off) ts = guess - off2 * 60000;
  return new Date(ts);
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha YYYY-MM-DD en tz. */
export function ymdInTz(d: Date, tz: string): string {
  const w = wallParts(d, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** HH:MM en tz. */
export function hmInTz(d: Date, tz: string): string {
  const w = wallParts(d, tz);
  return `${pad(w.h)}:${pad(w.min)}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = domingo … 6 = sábado */
export function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToHm(n: number): string {
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "Lun 29 sep" */
export function shortDayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${DAYS_SHORT[weekdayOfYmd(ymd)]} ${d} ${MONTHS_ES[m - 1]}`;
}

/** "lunes 29 de septiembre" */
export function longDayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${DAYS_ES[weekdayOfYmd(ymd)]} ${d} de ${MONTHS_LONG[m - 1]}`;
}

/** "lunes 29 de septiembre, 10:30 hrs" para un instante en tz */
export function humanDateTime(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${longDayLabel(ymdInTz(d, tz))}, ${hmInTz(d, tz)} hrs`;
}

export const WEEKDAYS_ES = DAYS_ES;
