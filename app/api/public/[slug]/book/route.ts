import { NextResponse } from "next/server";
import { clinicBySlug } from "@/lib/public";
import { bookAppointment, normalizePhone } from "@/lib/booking";
import { getAccountByClinic } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await clinicBySlug(slug);
  if (!clinic) return NextResponse.json({ error: "Consultorio no encontrado" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (b.website) return NextResponse.json({ ok: true }); // honeypot anti-spam

  const name = String(b.name || "").trim();
  const phone = normalizePhone(String(b.phone || ""));
  const email = String(b.email || "").trim() || null;
  if (name.length < 3) return NextResponse.json({ error: "Ingresa tu nombre y apellido." }, { status: 400 });
  if (phone.length < 10 || phone.length > 15) return NextResponse.json({ error: "Ingresa un celular válido (ej: +56 9 1234 5678)." }, { status: 400 });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Correo inválido." }, { status: 400 });

  const res = await bookAppointment({
    clinic: clinic as any,
    serviceId: String(b.serviceId),
    startISO: String(b.start),
    dentistId: b.dentistId || null,
    patient: { phone, full_name: name, email, rut: b.rut || null },
    channel: "web",
    notes: b.notes ? String(b.notes).slice(0, 500) : null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });

  const acc = await getAccountByClinic(clinic.id);
  const waNumber = acc?.display_phone?.replace(/\D/g, "") || null;
  return NextResponse.json({ ok: true, appointment: res.appointment, whatsapp: waNumber });
}
