"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

const GROUPS = [
  { label: "General", items: [
    { href: "/panel", icon: "home", t: "Resumen" },
    { href: "/panel/citas", icon: "calendar", t: "Agenda" },
    { href: "/panel/conversaciones", icon: "chat", t: "Conversaciones", badge: "conv" },
    { href: "/panel/pacientes", icon: "users", t: "Pacientes" },
  ]},
  { label: "Configuración", items: [
    { href: "/panel/servicios", icon: "tooth", t: "Servicios y horarios" },
    { href: "/panel/whatsapp", icon: "whatsapp", t: "WhatsApp" },
    { href: "/panel/instagram", icon: "instagram", t: "Instagram" },
    { href: "/panel/usuarios", icon: "user", t: "Equipo" },
    { href: "/panel/ajustes", icon: "settings", t: "Ajustes" },
  ]},
];

export function PanelNav({ unread }: { unread: number }) {
  const path = usePathname();
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g.label} style={{ display: "contents" }}>
          <div className="side-label">{g.label}</div>
          {g.items.map((i) => {
            const on = i.href === "/panel" ? path === "/panel" : path.startsWith(i.href);
            return (
              <Link key={i.href} href={i.href} className={`nav-a${on ? " on" : ""}`}>
                <Icon name={i.icon} />
                {i.t}
                {i.badge === "conv" && unread > 0 && <span className="count">{unread}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
