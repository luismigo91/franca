import { MessageText } from '@/components/chat/message-text';

/** Respuesta del usuario, con el mismo componente de texto plano que los mensajes del flujo. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-foreground px-4 py-2 text-background">
        <span className="sr-only">Tú</span>
        <MessageText text={text} />
      </div>
    </div>
  );
}
