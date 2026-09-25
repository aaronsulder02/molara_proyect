import { NextResponse } from "next/server";
import { clinicBySlug } from "@/lib/public";
import { getSlots } from "@/lib/availability";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await clinicBySlug(slug);
  if (!clinic) return NextResponse.json({ error: "Consultorio no encontrado" }, { status: 404 });
  const u = new URL(req.url);
  const serviceId = u.searchParams.get("service");
  const date = u.searchParams.get("date");
  if (!serviceId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  const dentist = u.searchParams.get("dentist") || null;
  const slots = await getSlots(clinic as any, { serviceId, ymd: date, dentistId: dentist, collapse: !dentist && u.searchParams.get("all") !== "1" });
  return NextResponse.json({ slots });
}
