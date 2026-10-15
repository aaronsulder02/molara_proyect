"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { cleanHandle } from "@/lib/bot";

type S = { error?: string; ok?: string } | undefined;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Fidelización: link de reseñas de Google (día siguiente a la cita) e invitación a seguir el Instagram. */
export async function saveReviewLink(_: S, fd: FormData): Promise<S> {
  try {
    const { clinic } = await requireAdmin();
    const url = str(fd, "google_review_url");
    if (url && !/^https:\/\/\S+$/.test(url)) return { error: "El link de reseñas debe empezar con https:// (cópialo desde tu Perfil de Empresa de Google)." };
    const rawIg = str(fd, "instagram_handle");
    const handle = rawIg ? cleanHandle(rawIg) : null;
    if (rawIg && !handle) return { error: "Usuario de Instagram inválido. Escríbelo como @tuconsultorio o pega el link del perfil." };
    const { error } = await db()
      .from("clinics")
      .update({
        google_review_url: url || null,
        review_template: str(fd, "review_template") || null,
        review_template_lang: str(fd, "review_template_lang") || "es",
        instagram_handle: handle,
        instagram_perk: str(fd, "instagram_perk").slice(0, 120) || null,
      })
      .eq("id", clinic.id);
    if (error) return { error: error.message };
    revalidatePath("/panel", "layout");
    return { ok: "Fidelización guardada ✔" };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
