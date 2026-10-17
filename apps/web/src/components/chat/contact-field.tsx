import type { RefObject } from 'react';
import { COPY } from '@/lib/chat/copy';

interface ContactFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Mensaje cuando la API rechazó el identificador (400 `invalid_request`). */
  error: string | null;
  /** Para llevarle el foco cuando la API rechaza el identificador. */
  inputRef: RefObject<HTMLInputElement | null>;
}

/** Campo opcional «Identificador de contacto» (D16): no se recuerda entre visitas ni se guarda en el navegador. */
export function ContactField({ value, onChange, error, inputRef }: ContactFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="contact-id" className="text-sm font-medium">
        {COPY.contactLabel}
      </label>
      <input
        id="contact-id"
        ref={inputRef}
        name="contactId"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? 'contact-hint contact-error' : 'contact-hint'}
        className="min-h-10 w-full max-w-sm rounded-md border border-foreground/30 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground aria-invalid:border-red-700 dark:aria-invalid:border-red-400"
      />
      <p id="contact-hint" className="text-xs opacity-70">
        {COPY.contactHint}
      </p>
      {error !== null && (
        <p id="contact-error" role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
