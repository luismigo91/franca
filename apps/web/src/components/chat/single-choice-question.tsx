import { Button } from '@/components/ui/button';
import type { ChatInput } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';
import type { ChoiceOption } from '@/lib/chat/events';
import { admitUrl } from '@/lib/chat/url-filter';

/** Imagen decorativa de una opción: el `label` es el nombre. Si la dirección no se admite, la opción va sin imagen. */
export function OptionImage({ imageUrl }: { imageUrl: unknown }) {
  const href = admitUrl(imageUrl, 'option-image');
  if (href === null) return null;
  // eslint-disable-next-line @next/next/no-img-element -- next/image haría que el servidor de la web pidiera la URL remota (SSRF desde la frontera, D13).
  return <img src={href} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" className="h-10 w-10 rounded object-cover" />;
}

interface SingleChoiceProps {
  choices: ChoiceOption[];
  describedBy: string | undefined;
  disabled: boolean;
  firstControl: React.RefObject<HTMLElement | null>;
  onSend: (input: ChatInput, label: string) => void;
}

/** Selección única: un botón por opción, en el orden del evento, que envía `{choice: id}` al pulsarse. */
export function SingleChoiceQuestion({ choices, describedBy, disabled, firstControl, onSend }: SingleChoiceProps) {
  return (
    <form noValidate onSubmit={(event) => event.preventDefault()} aria-label={COPY.answerLabel} aria-describedby={describedBy} className="flex flex-wrap gap-2">
      {choices.map((choice, index) => (
        <Button
          key={choice.id}
          ref={index === 0 ? (firstControl as React.RefObject<HTMLButtonElement | null>) : undefined}
          variant="secondary"
          disabled={disabled}
          onClick={() => onSend({ choice: choice.id }, choice.label)}
          className="gap-2"
        >
          <OptionImage imageUrl={choice.imageUrl} />
          <span className="[overflow-wrap:anywhere]">{choice.label}</span>
        </Button>
      ))}
    </form>
  );
}
