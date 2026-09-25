"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Submit } from "@/components/Submit";
import { connectWhatsapp } from "../actions";

export function ConnectForm({ current, demo }: { current: { phone_number_id: string; waba_id: string } | null; demo: { phone: string; waba: string } | null }) {
  const [useDemo, setUseDemo] = useState(false);
  return (
    <ActionForm action={connectWhatsapp} className="form-grid">
      {demo && (
        <label className="check card" style={{ padding: 14, background: "var(--mint-50)", borderColor: "#c7efe7" }}>
          <input type="checkbox" name="use_demo" checked={useDemo} onChange={(e) => setUseDemo(e.target.checked)} />
          <span>
            <b>Usar el número de ejemplo de la plataforma</b>
            <span className="hint" style={{ display: "block" }}>
              Credenciales del archivo .env (Phone Number ID {demo.phone} · WABA {demo.waba}). Ideal para probar ahora mismo.
            </span>
          </span>
        </label>
      )}
      <fieldset disabled={useDemo} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14, opacity: useDemo ? 0.5 : 1 }}>
        <div className="form-row">
          <label className="field">
            <span>Phone Number ID</span>
            <input className="input mono" name="phone_number_id" defaultValue={current?.phone_number_id ?? ""} placeholder="Ej: 5618…" inputMode="numeric" />
            <span className="hint">Meta → WhatsApp → Configuración de la API</span>
          </label>
          <label className="field">
            <span>WhatsApp Business Account ID</span>
            <input className="input mono" name="waba_id" defaultValue={current?.waba_id ?? ""} placeholder="Ej: 5159…" inputMode="numeric" />
            <span className="hint">Identificador de la cuenta de WhatsApp Business</span>
          </label>
        </div>
        <label className="field">
          <span>Token de acceso permanente</span>
          <input className="input mono" name="access_token" type="password" placeholder={current ? "•••••• (déjalo vacío para mantener el actual)" : "EAAG…"} autoComplete="off" />
          <span className="hint">Token de Usuario del sistema con permisos whatsapp_business_messaging y whatsapp_business_management.</span>
        </label>
      </fieldset>
      <div><Submit className="btn btn-primary" pendingText="Verificando con Meta…">{current ? "Actualizar y verificar" : "Verificar y conectar"}</Submit></div>
    </ActionForm>
  );
}
