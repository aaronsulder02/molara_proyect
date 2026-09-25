import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSlots } from "../lib/slots.ts";
import { zonedToUtc, ymdInTz, hmInTz, weekdayOfYmd, addDaysYmd, tzOffsetMinutes } from "../lib/time.ts";

const TZ = "America/Santiago";

test("zonedToUtc respeta la zona horaria de Chile (verano UTC-3 / invierno UTC-4)", () => {
  assert.equal(zonedToUtc("2026-01-15", "10:00", TZ).toISOString(), "2026-01-15T13:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-15", "10:00", TZ).toISOString(), "2026-07-15T14:00:00.000Z");
  const d = zonedToUtc("2026-09-29", "10:30", TZ);
  assert.equal(ymdInTz(d, TZ), "2026-09-29");
  assert.equal(hmInTz(d, TZ), "10:30");
});

test("utilidades de fecha", () => {
  assert.equal(weekdayOfYmd("2026-09-28"), 1); // lunes
  assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
  assert.equal(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), TZ), -180);
});

const base = {
  ymd: "2026-09-29",
  tz: TZ,
  durationMin: 30,
  stepMin: 15,
  dentists: [{ id: "d1", name: "Dra. Paz" }, { id: "d2", name: "Dr. Soto" }],
  schedules: [
    { dentist_id: "d1", start_time: "09:00", end_time: "10:00" },
    { dentist_id: "d2", start_time: "09:30", end_time: "10:30" },
  ],
  busy: [] as any[],
  now: new Date("2026-09-01T00:00:00Z"),
  minNoticeMin: 60,
};

test("genera horarios dentro del bloque sin salirse por la duración", () => {
  const s = computeSlots(base);
  const d1 = s.filter((x) => x.dentistId === "d1").map((x) => x.hm);
  assert.deepEqual(d1, ["09:00", "09:15", "09:30"]);
  const d2 = s.filter((x) => x.dentistId === "d2").map((x) => x.hm);
  assert.deepEqual(d2, ["09:30", "09:45", "10:00"]);
});

test("excluye choques con citas y bloqueos generales", () => {
  const busy = [
    { dentist_id: "d1", start: zonedToUtc(base.ymd, "09:15", TZ), end: zonedToUtc(base.ymd, "09:45", TZ) },
    { dentist_id: null, start: zonedToUtc(base.ymd, "10:15", TZ), end: zonedToUtc(base.ymd, "11:00", TZ) },
  ];
  const s = computeSlots({ ...base, busy });
  assert.deepEqual(s.filter((x) => x.dentistId === "d1").map((x) => x.hm), []); // 09:00-09:30 choca 09:15; 09:30 choca
  assert.deepEqual(s.filter((x) => x.dentistId === "d2").map((x) => x.hm), ["09:30", "09:45"]);
});

test("respeta la anticipación mínima", () => {
  const now = zonedToUtc(base.ymd, "08:45", TZ); // +60 min => desde 09:45
  const s = computeSlots({ ...base, now });
  assert.ok(s.every((x) => x.hm >= "09:45"));
});

test("collapse deja un horario por hora (primer profesional libre)", () => {
  const s = computeSlots({ ...base, collapse: true });
  assert.deepEqual(s.map((x) => x.hm), ["09:00", "09:15", "09:30", "09:45", "10:00"]);
});
