"use client";
import { login } from "../actions";
import { Submit } from "@/components/Submit";
import { ActionForm } from "@/components/ActionForm";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={login}>
      <input type="hidden" name="next" value={next || "/panel"} />
      <label className="field"><span>Correo</span><input className="input" name="email" type="email" autoComplete="email" required placeholder="tu@consultorio.cl" /></label>
      <label className="field"><span>Contraseña</span><input className="input" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" /></label>
      <Submit className="btn btn-primary btn-lg btn-block" pendingText="Ingresando…">Ingresar</Submit>
    </ActionForm>
  );
}
