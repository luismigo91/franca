'use client';

import { useState, type FormEvent, type RefObject } from 'react';
import { OptionImage } from '@/components/chat/single-choice-question';
import { Button } from '@/components/ui/button';
import type { ChatInput } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';
import type { ChoiceOption } from '@/lib/chat/events';

interface MultipleChoiceProps {
  choices: ChoiceOption[];
  describedBy: string | undefined;
  disabled: boolean;
  /** Los `id` marcados de una respuesta no enviada; solo se recuperan los que siguen existiendo. */
  initial: string[];
  firstControl: RefObject<HTMLElement | null>;
  onSend: (input: ChatInput, label: string) => void;
}

/**
 * Selección múltiple: una casilla por opción y «Enviar», que manda `{choices}` con las marcadas **en el orden de las
 * opciones**. Se puede enviar sin marcar ninguna: el flujo decide si la respuesta es válida.
 */
export function MultipleChoiceQuestion({ choices, describedBy, disabled, initial, firstControl, onSend }: MultipleChoiceProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(initial.filter((id) => choices.some((choice) => choice.id === id))));
  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = () => {
    const marked = choices.filter((choice) => checked.has(choice.id));
    onSend({ choices: marked.map((choice) => choice.id) }, marked.map((choice) => choice.label).join(', '));
  };

  // Siempre `preventDefault`: ni `action` ni `method`, y nunca un envío nativo.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled) submit();
  };

  return (
    <form noValidate onSubmit={handleSubmit} aria-label={COPY.answerLabel} aria-describedby={describedBy} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Elige las opciones</legend>
        {choices.map((choice, index) => (
          <label key={choice.id} className="flex min-h-10 items-center gap-3 rounded-md border border-foreground/20 px-3 py-2">
            <input
              type="checkbox"
              name="choices"
              value={choice.id}
              checked={checked.has(choice.id)}
              aria-disabled={disabled || undefined}
              onChange={() => {
                if (!disabled) toggle(choice.id);
              }}
              ref={index === 0 ? (firstControl as RefObject<HTMLInputElement | null>) : undefined}
              className="size-4"
            />
            <OptionImage imageUrl={choice.imageUrl} />
            <span className="[overflow-wrap:anywhere]">{choice.label}</span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" aria-disabled={disabled || undefined} className="self-start">
        {COPY.send}
      </Button>
    </form>
  );
}
