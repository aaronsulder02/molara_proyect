import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authClient, db } from "./supabase";

export const AT_COOKIE = "mo_at";
export const RT_COOKIE = "mo_rt";

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setSessionCookies(accessToken: string, refreshToken: string) {
  const jar = await cookies();
  jar.set(AT_COOKIE, accessToken, { ...cookieBase, maxAge: 60 * 60 * 24 * 7 });
  jar.set(RT_COOKIE, refreshToken, { ...cookieBase, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(AT_COOKIE);
  jar.delete(RT_COOKIE);
}

export type Role = "owner" | "admin" | "staff";

export type Ctx = {
  user: { id: string; email: string };
  role: Role;
  memberName: string;
  clinic: any;
};

/** Usuario autenticado + consultorio. Cacheado por request. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  const at = jar.get(AT_COOKIE)?.value;
  if (!at) return null;
  const { data, error } = await authClient().auth.getUser(at);
  if (error || !data?.user) return null;

  const { data: member } = await db()
    .from("clinic_members")
    .select("role, full_name, clinic:clinics(*)")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member?.clinic) return null;

  return {
    user: { id: data.user.id, email: data.user.email ?? "" },
    role: member.role as Role,
    memberName: member.full_name ?? data.user.email ?? "",
    clinic: member.clinic,
  };
});

/** Para páginas y acciones del panel: exige sesión. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireContext();
  if (ctx.role === "staff") throw new Error("Solo administradores pueden realizar esta acción.");
  return ctx;
}
