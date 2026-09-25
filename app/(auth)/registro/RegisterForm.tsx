"use client";
import { register } from "../actions";
import { Submit } from "@/components/Submit";
import { ActionForm } from "@/components/ActionForm";

export function RegisterForm() {
  return (
    <ActionForm action={register}>
      <label className="field"><span>Nombre del consultorio</span><input className="input" name="clinic" required placeholder="Clínica Dental Sonríe" /></label>
      <div className="form-row">
        <label className="field"><span>Tu nombre</span><input className="input" name="name" required placeholder="Dra. Paz Morales" /></label>
        <label className="field"><span>Ciudad</span><input className="input" name="city" placeholder="Santiago" /></label>
      </div>
      <label className="field"><span>Teléfono del consultorio</span><input className="input" name="phone" placeholder="+56 2 2345 6789" /></label>
      <label className="field"><span>Correo (será tu usuario)</span><input className="input" name="email" type="email" autoComplete="email" required placeholder="tu@consultorio.cl" /></label>
      <label className="field"><span>Contraseña</span><input className="input" name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="Mínimo 8 caracteres" /></label>
      <Submit className="btn btn-primary btn-lg btn-block" pendingText="Creando tu consultorio…">Crear consultorio</Submit>
      <p className="tiny muted" style={{ textAlign: "center" }}>Cargaremos servicios y horarios de ejemplo que podrás editar.</p>
    </ActionForm>
  );
}
