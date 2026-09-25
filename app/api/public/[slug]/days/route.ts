import { NextResponse } from "next/server";
import { clinicBySlug } from "@/lib/public";
import { getAvailableDays } from "@/lib/availability";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const clinic = await clinicBySlug(slug);
  if (!clinic) return NextResponse.json({ error: "Consultorio no encontrado" }, { status: 404 });
  const u = new URL(req.url);
  const serviceId = u.searchParams.get("service");
  if (!serviceId) return NextResponse.json({ error: "Falta el servicio" }, { status: 400 });
  const days = await getAvailableDays(clinic as any, { serviceId, dentistId: u.searchParams.get("dentist") || null, limit: 21 });
  return NextResponse.json({ days });
}
