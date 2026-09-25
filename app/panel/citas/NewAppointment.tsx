"use client";
import { useEffect, useRef, useState } from "react";
import { ActionForm, CloseDialog } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { createAppointment } from "../actions";

type Opt = { id: string; name: string; duration_min?: number };

export function NewAppointment({
  slug,
  services,
  dentists,
  patients,
  today,
  autoOpen,
}: {
  slug: string;
  services: Opt[];
  dentists: Opt[];
  patients: { full_name: string | null; phone: string }[];
  today: string;
  autoOpen?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [service, setService] = useState(services[0]?.id ?? "");
  const [dentist, setDentist] = useState(dentists[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<{ hm: string }[] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => { if (autoOpen) ref.current?.showModal(); }, [autoOpen]);

  useEffect(() => {
    if (!service || !date) return;
    setSlots(null);
    const q = new URLSearchParams({ service, date, all: "1", ...(dentist ? { dentist } : {}) });
    fetch(`/api/public/${slug}/slots?${q}`).then((r) => r.json()).then((j) => setSlots(j.slots ?? [])).catch(() => setSlots([]));
  }, [service, dentist, date, slug]);

  const onPhone = (v: string) => {
    setPhone(v);
    const digits = v.replace(/\D/g, "");
    const p = patients.find((x) => x.phone.endsWith(digits) && digits.length >= 8);
    if (p?.full_name && !name) setName(p.full_name);
  };

  return (
    <>
      <button className="btn btn-primary" onClick={() => ref.current?.showModal()}>+ Nueva cita</button>
      <dialog ref={ref} className="modal">
        <ActionForm action={createAppointment} className="" resetOnOk closeDialog>
          <div className="modal-head"><h3>Nueva cita</h3><CloseDialog className="btn btn-ghost btn-sm">✕</CloseDialog></div>
          <div className="modal-body form-grid">
            <div className="form-row">
              <label className="field"><span>Celular del paciente</span>
                <input className="input" name="phone" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="+56 9 1234 5678" list="pt-list" required />
                <datalist id="pt-list">{patients.slice(0, 300).map((p) => <option key={p.phone} value={"+" + p.phone}>{p.full_name}</option>)}</datalist>
              </label>
              <label className="field"><span>Nombre</span><input className="input" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" /></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Servicio</span>
                <select className="select" name="service_id" value={service} onChange={(e) => setService(e.target.value)} required>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min} min)</option>)}
                </select>
              </label>
              <label className="field"><span>Profesional</span>
                <select className="select" name="dentist_id" value={dentist} onChange={(e) => setDentist(e.target.value)} required>
                  {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="field"><span>Fecha</span><input className="input" type="date" name="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} required /></label>
              <label className="field"><span>Hora</span><input className="input" type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} required /></label>
            </div>
            <div className="stack-sm">
              <span className="label">Horarios libres</span>
              {slots === null ? (
                <div className="skeleton" style={{ height: 34 }} />
              ) : slots.length ? (
                <div className="slots">
                  {slots.slice(0, 40).map((s) => (
                    <button type="button" key={s.hm} className={`slot-btn${time === s.hm ? " on" : ""}`} style={{ height: 34 }} onClick={() => setTime(s.hm)}>{s.hm}</button>
                  ))}
                </div>
              ) : (
                <span className="hint">Sin horarios libres ese día para este profesional. Puedes forzar una hora manual.</span>
              )}
            </div>
            <label className="field"><span>Notas</span><textarea className="textarea" name="notes" rows={2} style={{ minHeight: 60 }} placeholder="Motivo, indicaciones…" /></label>
            <label className="check"><input type="checkbox" name="confirmed" /> Marcar como confirmada</label>
            <label className="check"><input type="checkbox" name="force" /> Forzar fuera de horario (sobrecupo). Igual se impide el choque con otra cita.</label>
          </div>
          <div className="modal-foot">
            <CloseDialog>Cancelar</CloseDialog>
            <Submit pendingText="Agendando…">Agendar cita</Submit>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}
