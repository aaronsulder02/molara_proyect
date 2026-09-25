import { db } from "./supabase";

export async function clinicBySlug(slug: string) {
  const { data } = await db()
    .from("clinics")
    .select("id, name, slug, phone, email, address, city, timezone, about, hours_text, brand_color, slot_minutes, min_notice_min, booking_window_days")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}
