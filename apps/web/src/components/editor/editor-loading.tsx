/** Mientras se lee el flujo. */
export function EditorLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
      <p role="status" className="text-sm opacity-70">
        Cargando flujo…
      </p>
    </main>
  );
}
