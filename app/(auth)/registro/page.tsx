import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { AuthSide } from "../AuthSide";
import { RegisterForm } from "./RegisterForm";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  if (await getContext()) redirect("/panel");
  return (
    <div className="auth">
      <AuthSide />
      <main className="auth-main">
        <div className="auth-card stack">
          <Link href="/"><Logo size={30} /></Link>
          <div>
            <h1>Crea tu consultorio</h1>
            <p className="muted">14 días gratis. Sin tarjeta de crédito.</p>
          </div>
          <RegisterForm />
          <p className="small muted" style={{ textAlign: "center" }}>
            ¿Ya tienes cuenta? <Link href="/login" style={{ color: "var(--teal)", fontWeight: 600 }}>Ingresar</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
