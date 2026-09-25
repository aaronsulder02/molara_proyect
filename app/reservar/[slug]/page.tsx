import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { clinicBySlug } from "@/lib/public";
import { listServices } from "@/lib/availability";
import { db } from "@/lib/supabase";
import { Logo, LogoMark } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { BookingWizard } from "./BookingWizard";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await clinicBySlug(slug);
  return { title: c ? `Reserva tu hora · ${c.name}` : "Reserva", description: c ? `Agenda online en ${c.name}. Elige servicio, día y hora en segundos.` : undefined };
}

export default async function Reservar({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await clinicBySlug(slug);
  if (!clinic) notFound();
  const [services, { data: dentists }, { data: wa }] = await Promise.all([
    listServices(clinic.id),
    db().from("dentists").select("id, name, specialty, color").eq("clinic_id", clinic.id).eq("active", true).order("name"),
    db().from("whatsapp_accounts").select("display_phone").eq("clinic_id", clinic.id).maybeSingle(),
  ]);
  const waNumber = wa?.display_phone?.replace(/\D/g, "") || null;

  return (
    <div className="bk">
      <div className="bk-wrap">
        <header className="bk-head row-between">
          <div className="row">
            <LogoMark size={44} />
            <div>
              <h1 style={{ fontSize: 24 }}>{clinic.name}</h1>
              <div className="small muted">{[clinic.address, clinic.city].filter(Boolean).join(", ") || "Agenda online"}</div>
            </div>
          </div>
          {waNumber && (
            <a className="btn btn-wa" href={`https://wa.me/${waNumber}?text=${encodeURIComponent("Hola, quiero agendar una hora")}`} target="_blank">
              <Icon name="whatsapp" size={16} /> Agendar por WhatsApp
            </a>
          )}
        </header>

        <div className="bk-grid">
          <aside className="card card-pad stack-sm small">
            <b style={{ fontSize: 15 }}>Información</b>
            {clinic.about && <p className="muted">{clinic.about}</p>}
            {clinic.address && <div className="row"><Icon name="pin" size={16} /> {clinic.address}{clinic.city ? `, ${clinic.city}` : ""}</div>}
            {clinic.hours_text && <div className="row"><Icon name="clock" size={16} /> {clinic.hours_text}</div>}
            {clinic.phone && <div className="row"><Icon name="headset" size={16} /> {clinic.phone}</div>}
            <div className="divider" />
            <div className="row tiny muted"><Icon name="shield" size={14} /> Tus datos solo los ve el consultorio.</div>
          </aside>
          <BookingWizard slug={clinic.slug} services={services} dentists={dentists ?? []} clinicName={clinic.name} address={clinic.address} waNumber={waNumber} tz={clinic.timezone} />
        </div>
        <footer style={{ padding: "40px 0", textAlign: "center" }}>
          <a href="/" className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Agenda impulsada por <Logo size={18} /></a>
        </footer>
      </div>
    </div>
  );
}
