'use client';

import { useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import type { PendingQuestion } from '@/lib/chat/events';
import type { ChatInput } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';

type TextQuestion = Extract<PendingQuestion, { kind: 'text' }>;

const INPUT_MODE = { email: 'email', phone: 'tel', number: 'decimal', url: 'url', text: 'text', date: 'text', boolean: 'text' } as const;

interface TextQuestionProps {
  question: TextQuestion;
  describedBy: string | undefined;
  disabled: boolean;
  /** Respuesta no enviada que recupera el campo. */
  initial: string;
  firstControl: RefObject<HTMLElement | null>;
  onSend: (input: ChatInput, label: string) => void;
}

/**
 * Pregunta de texto (D15). `text` (y el `input` de un `llm`) usa un `<textarea>`: Intro envía y Mayúsculas+Intro añade
 * una línea, salvo durante una composición. Los demás tipos usan `<input type="text">` con `inputMode`: nunca
 * `type="email"`, `"url"`, `"number"` ni `"date"`, porque el navegador limpia o bloquea el valor y taparía la validación
 * del flujo. Sin `maxLength`, `required` ni `pattern`, y sin recortar nada.
 */
export function TextQuestion({ question, describedBy, disabled, initial, firstControl, onSend }: TextQuestionProps) {
  const [value, setValue] = useState(initial);
  const submit = () => onSend({ text: value }, value);
  // Siempre `preventDefault`: ni `action` ni `method`, y nunca un envío nativo (llevaría `Origin: null`).
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };
  const common = {
    id: 'answer',
    name: 'answer',
    'aria-label': COPY.answerLabel,
    'aria-describedby': describedBy,
    placeholder: question.placeholder,
    disabled,
    value,
    autoComplete: 'off',
    spellCheck: false,
    className:
      'w-full rounded-md border border-foreground/30 bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-60',
  } as const;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    submit();
  };

  return (
    <form noValidate onSubmit={handleSubmit} aria-label={COPY.answerLabel} aria-describedby={describedBy} className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        {question.inputType === 'text' ? (
          <textarea {...common} ref={firstControl as RefObject<HTMLTextAreaElement | null>} rows={2} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} />
        ) : (
          <input
            {...common}
            ref={firstControl as RefObject<HTMLInputElement | null>}
            type="text"
            inputMode={INPUT_MODE[question.inputType]}
            autoCapitalize={question.inputType === 'email' || question.inputType === 'url' ? 'none' : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </div>
      <Button type="submit" disabled={disabled}>
        {COPY.send}
      </Button>
    </form>
  );
}
