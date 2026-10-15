"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";

type S = { error?: string; ok?: string } | undefined;

/** Guarda el link de reseñas de Google que el asistente envía al terminar una reserva. */
export async function saveReviewLink(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const url = String(fd.get("google_review_url") ?? "").trim();
    if (url && !/^https:\/\/\S+$/.test(url)) return { error: "El link debe empezar con https:// (cópialo desde tu Perfil de Empresa de Google)." };
    const { error } = await db().from("clinics").update({ google_review_url: url || null }).eq("id", clinic.id);
    if (error) return { error: error.message };
    revalidatePath("/panel", "layout");
    return { ok: url ? "Link de reseñas guardado ✔" : "Invitación a reseñas desactivada" };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
