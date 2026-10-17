'use client';

import { useEffect, useRef } from 'react';
import { AnswerReason } from '@/components/chat/answer-reason';
import { MultipleChoiceQuestion } from '@/components/chat/multiple-choice-question';
import { SingleChoiceQuestion } from '@/components/chat/single-choice-question';
import { TextQuestion } from '@/components/chat/text-question';
import { Notice } from '@/components/ui/notice';
import type { ChatInput } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';
import type { PendingQuestion as Question } from '@/lib/chat/events';

interface PendingQuestionProps {
  question: Question;
  /** Respuesta no enviada que la pregunta recupera si es del mismo tipo. */
  draft: ChatInput | null;
  disabled: boolean;
  onSend: (input: ChatInput, label: string) => void;
}

/**
 * La pregunta pendiente (D15). Cada control va en un `<form noValidate>` sin `action` ni `method`: su `onSubmit` llama
 * siempre a `preventDefault()` y se envía con el cliente (`fetch` en modo `cors`). Un envío nativo llevaría `Origin:
 * null` y la frontera lo rechazaría. Cuando aparece, el foco va a su primer control. Se monta con una `key` por
 * pregunta (`nodeId:attempt:revision`).
 */
export function PendingQuestion({ question, draft, disabled, onSend }: PendingQuestionProps) {
  const firstControl = useRef<HTMLElement | null>(null);
  const reasonId = 'answer-reason';

  useEffect(() => {
    firstControl.current?.focus();
  }, []);

  if (question.kind === 'unsupported') return <Notice>{COPY.unsupportedQuestion}</Notice>;

  const describedBy = question.reason !== null ? reasonId : undefined;

  return (
    <div className="flex flex-col gap-2">
      {question.reason !== null && <AnswerReason id={reasonId} reason={question.reason} />}
      {question.kind === 'text' && (
        <TextQuestion
          question={question}
          describedBy={describedBy}
          disabled={disabled}
          initial={draft !== null && 'text' in draft ? draft.text : ''}
          firstControl={firstControl}
          onSend={onSend}
        />
      )}
      {question.kind === 'choice' && !question.multiple && (
        <SingleChoiceQuestion choices={question.choices} describedBy={describedBy} disabled={disabled} firstControl={firstControl} onSend={onSend} />
      )}
      {question.kind === 'choice' && question.multiple && (
        <MultipleChoiceQuestion
          choices={question.choices}
          describedBy={describedBy}
          disabled={disabled}
          initial={draft !== null && 'choices' in draft ? draft.choices : []}
          firstControl={firstControl}
          onSend={onSend}
        />
      )}
    </div>
  );
}
