"use client";
import { createContext, startTransition, useActionState, useEffect, useRef } from "react";

/** Estado "enviando…" compartido con <Submit> (el formulario no usa action= para no borrar lo escrito si hay error). */
export const PendingContext = createContext(false);

export type FormState = { error?: string; ok?: string; data?: any } | undefined;

/**
 * Formulario genérico para server actions con retroalimentación (éxito/error).
 * `resetOnOk` limpia los campos tras guardar; `closeDialog` cierra el <dialog> contenedor.
 */
export function ActionForm({
  action,
  children,
  className = "form-grid",
  resetOnOk = false,
  closeDialog = false,
  id,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  resetOnOk?: boolean;
  closeDialog?: boolean;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnOk) ref.current?.reset();
      if (closeDialog) {
        const dlg = ref.current?.closest("dialog") as HTMLDialogElement | null;
        setTimeout(() => dlg?.close(), 700);
      }
    }
  }, [state, resetOnOk, closeDialog]);
  return (
    <form
      ref={ref}
      className={className}
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>
        {state?.error && <div className="alert alert-err" role="alert">{state.error}</div>}
        {state?.ok && <div className="alert alert-ok" role="status">{state.ok}</div>}
        {children}
      </PendingContext.Provider>
    </form>
  );
}

/** Botón que abre un <dialog> por id. */
export function OpenDialog({ target, children, className = "btn btn-primary" }: { target: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => (document.getElementById(target) as HTMLDialogElement)?.showModal()}>
      {children}
    </button>
  );
}

export function CloseDialog({ children = "Cerrar", className = "btn" }: { children?: React.ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={(e) => (e.currentTarget.closest("dialog") as HTMLDialogElement)?.close()}>
      {children}
    </button>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(text); b.textContent = "¡Copiado!"; } catch { b.textContent = "Copia manualmente"; }
        setTimeout(() => (b.textContent = label), 1500);
      }}
    >
      {label}
    </button>
  );
}

/** Botón de envío con confirmación nativa. */
export function ConfirmSubmit({ message, children, className = "btn btn-sm btn-danger" }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="submit" className={className} onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
