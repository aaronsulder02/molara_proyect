"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./Icon";

const PLANS = [
  {
    name: "Esencial",
    desc: "Para el odontólogo independiente que quiere dejar de agendar a mano.",
    monthly: 29990,
    features: [
      "1 profesional",
      "Asistente de WhatsApp con botones y listas",
      "Agenda web con link propio",
      "Recordatorios automáticos",
      "Bandeja de conversaciones",
      "2 usuarios del equipo",
    ],
  },
  {
    name: "Clínica",
    desc: "Para consultorios con varios sillones que quieren una recepción 24/7.",
    monthly: 59990,
    pop: true,
    features: [
      "Hasta 6 profesionales",
      "Todo lo de Esencial",
      "Asistente con IA conversacional",
      "Reagendamiento y confirmación en 1 toque",
      "Métricas de Instagram",
      "Usuarios ilimitados",
    ],
  },
  {
    name: "Red",
    desc: "Para centros y cadenas con alto volumen de pacientes.",
    monthly: 119990,
    features: [
      "Profesionales ilimitados",
      "Todo lo de Clínica",
      "Instrucciones de IA personalizadas",
      "Acompañamiento en la verificación con Meta",
      "Soporte prioritario por WhatsApp",
      "Reportes a medida",
    ],
  },
];

const clp = (n: number) => "$" + n.toLocaleString("es-CL");

export function Pricing() {
  const [annual, setAnnual] = useState(false);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
        <div className="toggle" role="tablist" aria-label="Periodo de facturación">
          <button className={!annual ? "on" : ""} onClick={() => setAnnual(false)} role="tab" aria-selected={!annual}>Mensual</button>
          <button className={annual ? "on" : ""} onClick={() => setAnnual(true)} role="tab" aria-selected={annual}>
            Anual <span style={{ color: "var(--teal)" }}>· 2 meses gratis</span>
          </button>
        </div>
      </div>
      <div className="pricing">
        {PLANS.map((p) => {
          const price = annual ? Math.round((p.monthly * 10) / 12 / 10) * 10 : p.monthly;
          return (
            <div key={p.name} className={`plan${p.pop ? " pop" : ""}`}>
              <div>
                <h3>{p.name}</h3>
                <p className="muted small" style={{ marginTop: 6 }}>{p.desc}</p>
              </div>
              <div className="price">
                {clp(price)} <small>/ mes + IVA</small>
                {annual && <div className="tiny muted" style={{ fontFamily: "var(--font)", fontWeight: 500, letterSpacing: 0 }}>facturado anualmente ({clp(p.monthly * 10)})</div>}
              </div>
              <Link href="/registro" className={`btn btn-lg btn-block ${p.pop ? "btn-primary" : "btn-dark"}`}>
                Probar 14 días gratis
              </Link>
              <ul>
                {p.features.map((f) => (
                  <li key={f}><Icon name="check" size={16} stroke={2.4} />{f}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="center small muted" style={{ textAlign: "center", marginTop: 22 }}>
        Sin costo de implementación · Sin contrato de permanencia · Las conversaciones de WhatsApp las cobra Meta directamente a tu cuenta según su tarifa oficial.
      </p>
    </>
  );
}
