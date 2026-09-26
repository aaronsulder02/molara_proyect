import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEs, mergeFields, normEs, calendarLines } from "../lib/nlu";

const services = [{ id: "S1", name: "Evaluación" }, { id: "S2", name: "Limpieza dental" }, { id: "S3", name: "Ortodoncia" }];
const today = "2026-09-26"; // sábado
const p = (t: string, step?: any) => parseEs(t, { today, services, step });

test("frase completa dictada por audio", () => {
  assert.deepEqual(p("Hola, quiero agendar una limpieza para el jueves a las 4 de la tarde"), { intent: "agendar", serviceId: "S2", ymd: "2026-10-01", hm: "16:00" });
});

test("días relativos y con nombre", () => {
  assert.equal(p("para mañana").ymd, "2026-09-27");
  assert.equal(p("pasado mañana").ymd, "2026-09-28");
  assert.equal(p("hoy mismo").ymd, "2026-09-26");
  assert.equal(p("el lunes").ymd, "2026-09-28");
  assert.equal(p("el sábado").ymd, "2026-09-26", "mismo día de la semana = hoy");
  assert.equal(p("el próximo sábado").ymd, "2026-10-03");
  assert.equal(p("el miércoles").ymd, "2026-09-30");
});

test("mañana como día vs. como franja", () => {
  assert.deepEqual(p("mañana en la mañana"), { intent: "agendar", ymd: "2026-09-27", range: "am" });
  const f = p("en la mañana");
  assert.equal(f.ymd, undefined); assert.equal(f.range, "am");
});

test("fechas explícitas", () => {
  assert.equal(p("el 3 de octubre").ymd, "2026-10-03");
  assert.equal(p("3/10").ymd, "2026-10-03");
  assert.equal(p("el 30").ymd, "2026-09-30");
  assert.equal(p("el 5").ymd, "2026-10-05", "día ya pasado este mes → próximo mes");
  assert.equal(p("el 31 de febrero").ymd, undefined, "fecha inválida");
});

test("horas habladas", () => {
  assert.equal(p("a las 4").hm, "16:00", "consultorio: 4 = 16:00");
  assert.equal(p("a las 10").hm, "10:00");
  assert.equal(p("a las 10 y media").hm, "10:30");
  assert.equal(p("a las cuatro y media").hm, "16:30");
  assert.equal(p("15:30").hm, "15:30");
  assert.equal(p("a las 9 de la mañana").hm, "09:00");
  assert.equal(p("a las 8 de la noche").hm, "20:00");
  assert.equal(p("tipo 11").hm, "11:00");
  assert.equal(p("al mediodía").hm, "12:00");
  assert.equal(p("a las 5 menos cuarto").hm, "16:45");
  assert.equal(p("el 3 de octubre").hm, undefined, "el día no se confunde con hora");
});

test("franjas", () => {
  assert.equal(p("en la tarde").range, "pm");
  assert.equal(p("temprano").range, "am");
  assert.equal(p("después del trabajo").range, "noche");
});

test("intenciones", () => {
  assert.equal(p("sí, confírmala").intent, "confirmar");
  assert.equal(p("dale").intent, "confirmar");
  assert.equal(p("no").intent, "rechazar");
  assert.equal(p("mejor a las 5").intent, "cambiar");
  assert.equal(p("cancela todo").intent, "cancelar");
  assert.equal(p("cuánto cuesta la limpieza?").intent, "otra", "pregunta de precio no es reserva");
  assert.equal(p("dónde quedan?").intent, "otra");
  assert.equal(p("quiero agendar una limpieza, cuánto cuesta?").intent, "agendar");
});

test("servicios por sinónimos", () => {
  assert.equal(p("quiero una revisión").serviceId, "S1");
  assert.equal(p("necesito sacarme el sarro").serviceId, "S2");
  assert.equal(p("consulta por brackets").serviceId, "S3");
});

test("nombre", () => {
  assert.equal(p("me llamo Camila Rojas y quiero una evaluación").name, "Camila Rojas");
  assert.equal(p("Camila Rojas", "name").name, "Camila Rojas");
  assert.equal(p("sí", "name").name, undefined);
  assert.equal(p("Camila Rojas").name, undefined, "fuera del paso nombre no se asume");
});

test("mergeFields valida lo que devuelve el modelo", () => {
  const det = p("quiero hora");
  const m = mergeFields({ intencion: "agendar", servicio_id: "S2", fecha: "2026-10-01", hora: "16:00", nombre: "Ana Pérez" }, det, { today, services, windowDays: 30 });
  assert.deepEqual(m, { intent: "agendar", serviceId: "S2", ymd: "2026-10-01", hm: "16:00", name: "Ana Pérez" });
  const bad = mergeFields({ intencion: "hackear", servicio_id: "XX", fecha: "2020-01-01", hora: "25:00", nombre: "123" }, p("el jueves a las 4"), { today, services, windowDays: 30 });
  assert.deepEqual(bad, { intent: "agendar", ymd: "2026-10-01", hm: "16:00" }, "datos inválidos del modelo se descartan");
  assert.equal(mergeFields({ fecha: "2027-01-01" }, det, { today, services, windowDays: 30 }).ymd, undefined, "fuera de la ventana de reserva");
  assert.equal(mergeFields(null, det, { today, services, windowDays: 30 }).intent, "agendar", "sin IA → determinista");
  assert.equal(mergeFields(null, p("precio de limpieza"), { today, services, windowDays: 30 }).intent, "otra", "IA caída: pregunta de precio sigue siendo pregunta");
});

test("utilidades", () => {
  assert.equal(normEs("¿A las 10.30, MAÑANA?"), "a las 10:30 manana");
  assert.match(calendarLines(today, 3), /2026-09-26 = sabado \(hoy\)\n2026-09-27 = domingo \(mañana\)\n2026-09-28 = lunes/);
});
