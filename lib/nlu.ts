// Comprensión de lenguaje para el formulario de reserva (texto o transcripción de audio).
//
// Dos capas que se complementan:
//  1. parseEs(): parser determinista en español de Chile (fechas, horas, franjas, sí/no, nombre, servicio).
//     Funciona sin IA y sirve para validar lo que devuelve el modelo.
//  2. extractWithAI(): el modelo recibe el paso actual del formulario, el calendario de los próximos días
//     y los servicios, y devuelve JSON. Se valida campo por campo y se completa con la capa 1.
import { addDaysYmd, weekdayOfYmd, pad } from "./time.ts";

export type Range = "am" | "pm" | "noche";
export type Intent = "agendar" | "confirmar" | "rechazar" | "cambiar" | "cancelar" | "otra";
export type FormStep = "service" | "day" | "slot" | "name" | "confirm" | undefined;

export type Fields = {
  intent: Intent;
  serviceId?: string;
  ymd?: string;
  hm?: string;
  range?: Range;
  name?: string;
};

export type ServiceLite = { id: string; name: string; description?: string | null };

export const normEs = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)[.:](\d{2})\b/g, "$1:$2") // conserva horas "10:30" / "10.30"
    .replace(/[¿?¡!.,;"“”()]/g, " ")
    .replace(/(^|\s):|:(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const NUMS: Record<string, number> = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
};
const NUM_WORDS = Object.keys(NUMS).join("|");
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMS[s]);

/** Próxima fecha (incluida hoy) con ese día de la semana; "proximo/que viene" salta a la semana siguiente si cae hoy. */
function nextWeekday(today: string, wd: number, forceNext = false) {
  const diff = (wd - weekdayOfYmd(today) + 7) % 7;
  return addDaysYmd(today, diff === 0 && forceNext ? 7 : diff);
}

function dateFrom(t: string, today: string): string | undefined {
  if (/\bpasado manana\b/.test(t)) return addDaysYmd(today, 2);
  // "mañana" como día; "en/por/de la mañana" es franja horaria, no día
  const t2 = t.replace(/\b(en|por|de|a|esta) la manana\b/g, " ").replace(/\besta manana\b/g, " ");
  if (/\bmanana\b/.test(t2)) return addDaysYmd(today, 1);
  if (/\bhoy\b/.test(t)) return today;
  for (let i = 0; i < 7; i++) {
    const m = t.match(new RegExp(`\\b(proximo|este|el)?\\s*${WEEKDAYS[i]}\\b(\\s+(que viene|proximo))?`));
    if (m) return nextWeekday(today, i, !!(m[1] === "proximo" || m[3]));
  }
  const [ty, tm] = today.split("-").map(Number);
  const build = (d: number, m: number) => {
    let y = ty;
    const cand = `${y}-${pad(m)}-${pad(d)}`;
    if (cand < today) y += 1;
    const out = `${y}-${pad(m)}-${pad(d)}`;
    const [yy, mm, dd] = out.split("-").map(Number);
    const chk = new Date(Date.UTC(yy, mm - 1, dd));
    return chk.getUTCMonth() === mm - 1 ? out : undefined;
  };
  // "3 de octubre", "el 3 de oct"
  const mDM = t.match(new RegExp(`\\b(\\d{1,2}|${NUM_WORDS})\\s+de\\s+(${MONTHS.join("|")}|${MONTHS.map((x) => x.slice(0, 3)).join("|")})\\b`));
  if (mDM) {
    const mi = MONTHS.findIndex((x) => x.startsWith(mDM[2].slice(0, 3)));
    return build(toNum(mDM[1]), mi + 1);
  }
  // "3/10", "3-10"
  const mSlash = t.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (mSlash && Number(mSlash[2]) <= 12) return build(Number(mSlash[1]), Number(mSlash[2]));
  // "el dia 3", "el 3" (no seguido de hora/":")
  const mDay = t.match(/\b(?:el dia|el|dia)\s+(\d{1,2})\b(?!\s*(:|hrs|horas|h\b|de la|y media|y cuarto|am|pm))/);
  if (mDay) {
    const d = Number(mDay[1]);
    if (d >= 1 && d <= 31) {
      let m = tm;
      let cand = build(d, m);
      if (!cand || cand < today || cand.slice(0, 4) !== String(ty)) {
        m = tm === 12 ? 1 : tm + 1;
        cand = build(d, m);
      }
      return cand;
    }
  }
  return undefined;
}

function timeFrom(t: string): { hm?: string; range?: Range } {
  let range: Range | undefined;
  if (/\b(en|por|de|a) la manana\b|\btemprano\b|\bantes de almuerzo\b|\bantes del almuerzo\b/.test(t)) range = "am";
  if (/\b(en|por|de|a) la tarde\b|\bdespues (de|del) almuerzo\b/.test(t)) range = "pm";
  if (/\b(en|por|de|a) la noche\b|\bdespues de la pega\b|\bdespues del trabajo\b|\bvespertino\b/.test(t)) range = "noche";
  if (/\bmediodia\b|\bmedio dia\b/.test(t)) return { hm: "12:00" };

  // Buscar la mejor coincidencia que parezca hora (con "a las", ":" o sufijo)
  const all = [...t.matchAll(new RegExp(`\\b(a las|a la|las|tipo|como a las|cerca de las)?\\s*(\\d{1,2}|${NUM_WORDS})(?:[:.h](\\d{2}))?\\s*(y media|y cuarto|y quince|y treinta|menos cuarto)?\\s*(am|pm|hrs|horas|de la manana|de la tarde|de la noche)?(?=\\s|$)`, "g"))];
  for (const x of all) {
    const [, lead, hs, mins, frac, suf] = x;
    const looksTime = !!(lead || mins || frac || suf);
    if (!looksTime) continue;
    let h = toNum(hs);
    if (h === undefined || h > 23) continue;
    // evitar confundir "el 3 de octubre"/"3/10" con hora
    const after = t.slice((x.index ?? 0) + x[0].length);
    if (!lead && !mins && !suf && /^\s*de\s+(\w+)/.test(after)) continue;
    let mm = mins ? Number(mins) : 0;
    if (frac === "y media" || frac === "y treinta") mm = 30;
    if (frac === "y cuarto" || frac === "y quince") mm = 15;
    if (frac === "menos cuarto") { h -= 1; mm = 45; }
    const pmHint = suf === "pm" || suf === "de la tarde" || suf === "de la noche" || (!suf && (range === "pm" || range === "noche"));
    const amHint = suf === "am" || suf === "de la manana";
    if (pmHint && h < 12) h += 12;
    else if (!amHint && !pmHint && h >= 1 && h <= 7) h += 12; // en un consultorio "a las 4" = 16:00
    if (h > 23 || mm > 59) continue;
    return { hm: `${pad(h)}:${pad(mm)}`, range: undefined };
  }
  return { range };
}

const YES = /^(si|sip|sii+|claro|dale|ok|okay|okey|ya|listo|perfecto|confirmo|confirmar|confirmala|confirmalo|de acuerdo|correcto|bueno|genial|excelente|agendala|agendalo|reservala|me sirve|esa|ese|esa misma)\b/;
const NO = /^(no|nop|nopo|mejor no|todavia no)\b/;

function intentFrom(t: string): Intent {
  if (/\b(cancela|cancelar|anula|anular|ya no quiero|olvidalo|dejalo)\b/.test(t) && !/\bcita\b.*\bcancelar\b.*\bpara\b/.test(t)) return "cancelar";
  if (/\b(otro horario|otra hora|otro dia|cambiar|cambiala|mejor (el|a las|la|otro|otra)|prefiero)\b/.test(t)) return "cambiar";
  if (YES.test(t) || /\b(si confirmo|si por favor|si dale|confirmo|confirmala|agendala|reservala)\b/.test(t)) return "confirmar";
  if (NO.test(t)) return "rechazar";
  if (/\b(agend|reserv|hora|cita|turno|atender|atencion|disponib|quiero|necesito|puedo ir)\w*/.test(t)) return "agendar";
  return "otra";
}

function nameFrom(raw: string): string | undefined {
  const m = raw.match(/(?:me llamo|mi nombre es|soy|a nombre de)\s+([A-Za-zÁÉÍÓÚÑáéíóúñü]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñü]+){0,3})/i);
  if (!m) return undefined;
  const stop = /\b(y|quiero|necesito|para|el|la|de|a|con|por)\b.*$/i;
  const n = m[1].replace(stop, "").trim();
  return n.length >= 3 ? n : undefined;
}

const SYN: Record<string, string[]> = {
  limpieza: ["limpieza", "profilaxis", "destartraje", "sarro"],
  evaluacion: ["evaluacion", "revision", "control", "chequeo", "consulta", "diagnostico", "primera vez"],
  ortodoncia: ["ortodoncia", "frenillos", "brackets", "alineadores"],
  blanqueamiento: ["blanqueamiento", "blanquear", "aclarar"],
  endodoncia: ["endodoncia", "tratamiento de conducto", "conducto", "matar el nervio"],
  extraccion: ["extraccion", "sacar una muela", "sacar un diente", "sacarme", "muela del juicio"],
  urgencia: ["urgencia", "dolor", "me duele"],
  implante: ["implante", "implantes"],
};

// Palabras genéricas pesan menos ("consulta por brackets" → ortodoncia, no evaluación)
const GENERIC = new Set(["consulta", "control", "revision", "dolor"]);

export function matchService(t: string, services: ServiceLite[]): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const s of services) {
    const n = normEs(s.name);
    let score = 0;
    if (t.includes(n)) score += 10;
    for (const w of n.split(" ").filter((w) => w.length > 3)) if (new RegExp(`\\b${w}`).test(t)) score += 3;
    for (const [key, syns] of Object.entries(SYN))
      if (n.includes(key)) for (const x of syns) if (t.includes(x)) score += GENERIC.has(x) ? 2 : 5;
    if (score > 0 && (!best || score > best.score)) best = { id: s.id, score };
  }
  return best?.id;
}

/** Parser determinista (sin IA). */
export function parseEs(raw: string, opts: { today: string; services: ServiceLite[]; step?: FormStep }): Fields {
  const t = normEs(raw);
  const f: Fields = { intent: intentFrom(t) };
  const svc = matchService(t, opts.services);
  if (svc) f.serviceId = svc;
  const ymd = dateFrom(t, opts.today);
  if (ymd) f.ymd = ymd;
  const tm = timeFrom(t);
  if (tm.hm) f.hm = tm.hm;
  if (tm.range) f.range = tm.range;
  const name = nameFrom(raw);
  if (name) f.name = name;
  // En el paso "nombre", un texto corto sin números es el nombre
  if (opts.step === "name" && !f.name) {
    const clean = raw.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñü\s]/g, " ").replace(/\s+/g, " ").trim();
    const words = clean.split(" ");
    if (words.length >= 2 && words.length <= 5 && !/\d/.test(raw) && !YES.test(t) && !NO.test(t)) f.name = clean;
  }
  if (f.intent === "otra" && (f.serviceId || f.ymd || f.hm || f.range)) f.intent = "agendar";
  // Preguntas informativas ("¿cuánto cuesta la limpieza?") no son una reserva
  if (f.intent === "agendar" && isInfoQuestion(t) && !f.ymd && !f.hm && !f.range) f.intent = "otra";
  return f;
}

function isInfoQuestion(t: string) {
  return /\b(cuanto|precio|valor|cuesta|cobran|donde|direccion|ubicacion|como llego|aceptan|isapre|fonasa|convenio|duele|dura)\b/.test(t) &&
    !/\b(agend|reserv|quiero (una|un|hora|agendar|reservar)|necesito (una|un|hora)|me (das|puedes dar) (una )?hora)/.test(t);
}

/** Calendario explícito para que el modelo no calcule mal los días de la semana. */
export function calendarLines(today: string, days = 21) {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysYmd(today, i);
    out.push(`${d} = ${WEEKDAYS[weekdayOfYmd(d)]}${i === 0 ? " (hoy)" : i === 1 ? " (mañana)" : ""}`);
  }
  return out.join("\n");
}

const isYmd = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = (s: any) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Valida la salida del modelo y la completa con el parser determinista. */
export function mergeFields(ai: any, det: Fields, opts: { today: string; services: ServiceLite[]; windowDays: number }): Fields {
  const out: Fields = { ...det };
  const intents: Intent[] = ["agendar", "confirmar", "rechazar", "cambiar", "cancelar", "otra"];
  if (ai && typeof ai === "object") {
    if (intents.includes(ai.intencion)) out.intent = ai.intencion;
    if (typeof ai.servicio_id === "string" && opts.services.some((s) => s.id === ai.servicio_id)) out.serviceId = ai.servicio_id;
    const last = addDaysYmd(opts.today, opts.windowDays);
    if (isYmd(ai.fecha) && ai.fecha >= opts.today && ai.fecha <= last) out.ymd = ai.fecha;
    if (isHm(ai.hora)) out.hm = ai.hora;
    if (["am", "pm", "noche"].includes(ai.franja) && !out.hm) out.range = ai.franja;
    if (typeof ai.nombre === "string" && ai.nombre.trim().length >= 3 && ai.nombre.length <= 60 && !/\d/.test(ai.nombre)) out.name = ai.nombre.trim();
  }
  if (out.hm) delete out.range;
  // Mencionar solo un servicio no implica reservar ("¿cuánto cuesta la limpieza?"); un día u hora sí
  if (out.intent === "otra" && (out.ymd || out.hm || out.range)) out.intent = "agendar";
  return out;
}

export function extractionPrompt(opts: { today: string; now: string; step: FormStep; services: ServiceLite[]; offered?: string }) {
  return `Extraes datos para un formulario de reserva de hora dental. El paciente habla español de Chile (puede venir de una nota de voz transcrita, con errores).
Hoy: ${opts.today} ${opts.now}. Paso actual del formulario: ${opts.step ?? "ninguno"}.
${opts.offered ? `Opciones que el paciente está viendo:\n${opts.offered}\n` : ""}
CALENDARIO:
${calendarLines(opts.today)}

SERVICIOS (id · nombre):
${opts.services.map((s) => `${s.id} · ${s.name}`).join("\n")}

Responde SOLO un objeto JSON con estas claves (omite las que no apliquen):
{"intencion":"agendar|confirmar|rechazar|cambiar|cancelar|otra","servicio_id":"<id de la lista>","fecha":"YYYY-MM-DD","hora":"HH:MM (24h)","franja":"am|pm|noche","nombre":"Nombre Apellido"}
Reglas: "a las 4" en un consultorio es 16:00; "en la mañana"=am, "en la tarde"=pm. "confirmar" solo si acepta la reserva mostrada. "otra" si pregunta algo distinto (precio, ubicación…). No inventes datos.`;
}
