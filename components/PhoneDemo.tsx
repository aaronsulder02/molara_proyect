"use client";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./Logo";

type Step =
  | { k: "in" | "out"; text: string }
  | { k: "btns"; items: string[] }
  | { k: "list"; text: string; button: string }
  | { k: "typing" };

const SCRIPT: Step[] = [
  { k: "out", text: "Hola! quería una hora para limpieza 🦷" },
  { k: "typing" },
  { k: "in", text: "¡Hola Camila! 👋 Soy Sofía, de Clínica Sonríe. Tengo estos días para *Limpieza dental* (45 min):" },
  { k: "list", text: "Elige el día que te acomode", button: "☰ Elegir día" },
  { k: "out", text: "Jueves 2 oct" },
  { k: "typing" },
  { k: "in", text: "Perfecto. Horarios disponibles el jueves:" },
  { k: "btns", items: ["10:30 hrs · Dra. Paz", "12:00 hrs · Dr. Soto", "16:15 hrs · Dra. Paz"] },
  { k: "out", text: "10:30 hrs · Dra. Paz" },
  { k: "typing" },
  { k: "in", text: "✅ ¡Hora agendada!\n🦷 Limpieza dental\n📅 Jueves 2 de octubre, 10:30\n📍 Av. Providencia 1234\n\nTe recordaré el día anterior 😊" },
];

export function PhoneDemo() {
  const [n, setN] = useState(1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setN(SCRIPT.length); return; }
    const delay = SCRIPT[n - 1]?.k === "typing" ? 1100 : 1500;
    const t = setTimeout(() => setN((x) => (x >= SCRIPT.length ? 1 : x + 1)), n >= SCRIPT.length ? 4200 : delay);
    return () => clearTimeout(t);
  }, [n]);

  useEffect(() => { ref.current?.scrollTo({ top: 99999 }); }, [n]);

  const visible = SCRIPT.slice(0, n).filter((s, i) => s.k !== "typing" || i === n - 1);

  return (
    <div className="phone" aria-label="Demostración de conversación por WhatsApp">
      <div className="phone-screen">
        <div className="wa-top">
          <div className="av"><LogoMark size={30} /></div>
          <div>
            <b>Clínica Sonríe</b>
            <small>Cuenta de empresa · en línea</small>
          </div>
        </div>
        <div className="wa-body" ref={ref}>
          {visible.map((s, i) => {
            if (s.k === "typing") return <div key={i} className="typing"><i /><i /><i /></div>;
            if (s.k === "btns") return <div key={i} className="wa-btns">{s.items.map((b) => <div key={b}>{b}</div>)}</div>;
            if (s.k === "list")
              return (
                <div key={i} className="wa-list">
                  <p>{s.text}</p>
                  <div className="lb">{s.button}</div>
                </div>
              );
            return (
              <div key={i} className={`bub ${s.k}`}>
                {s.text.split(/(\*[^*]+\*)/).map((p, j) => (p.startsWith("*") ? <b key={j}>{p.slice(1, -1)}</b> : p))}
                <span className="t">10:2{Math.min(i, 9)} {s.k === "out" ? "✓✓" : ""}</span>
              </div>
            );
          })}
        </div>
        <div className="wa-input">
          <div>Mensaje</div>
          <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9 3 20.5Z" /></svg>
          </span>
        </div>
      </div>
    </div>
  );
}
