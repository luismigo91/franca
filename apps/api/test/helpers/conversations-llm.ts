import type { LlmCapability, LlmTurnRequest, LlmTurnResult } from '@franca/engine';

export type TurnHandler = (request: LlmTurnRequest, index: number) => LlmTurnResult | Promise<LlmTurnResult>;

/** Un turno que no termina el nodo. */
export const keepTalking = (costUsd = 0.01, text = 'sigo'): LlmTurnResult => ({ kind: 'turn', text, slots: {}, done: false, costUsd });

/** Un turno que termina el nodo. */
export const finishing = (costUsd = 0.01, text = 'Hola'): LlmTurnResult => ({ kind: 'turn', text, slots: {}, done: true, costUsd });

/** Una promesa que se resuelve cuando el test lo indica. */
export class Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;
  settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value) => {
        this.settled = true;
        resolve(value);
      };
      this.reject = reject;
    });
  }
}

/**
 * Proveedor `llm` guionizado del test: registra cada petición (copia con `structuredClone`, como un proveedor real que
 * se la queda) y responde lo que diga el manejador actual. El delegado `provider` es lo que ve la API como `principal`;
 * cambiar el manejador entre tests no obliga a recrear la aplicación.
 */
export class ScriptedLlm {
  readonly requests: LlmTurnRequest[] = [];
  private handler: TurnHandler = () => keepTalking();

  /** La capacidad que se registra como proveedor `principal`. */
  readonly provider: LlmCapability = async (request) => {
    const index = this.requests.length;
    this.requests.push(structuredClone(request));
    return this.handler(request, index);
  };

  /** Fija el manejador (o una respuesta fija). */
  use(handler: TurnHandler | LlmTurnResult): void {
    this.handler = typeof handler === 'function' ? handler : () => handler;
  }

  /** Peticiones recibidas y manejador por defecto. */
  reset(): void {
    this.requests.length = 0;
    this.handler = () => keepTalking();
  }

  /** Textos del `history` de la petición `index`. */
  historyOf(index: number): string[] {
    return this.requests[index]?.history.map((message) => message.text) ?? [];
  }

  /** Espera (hasta 5 s) a que el proveedor haya recibido `count` peticiones. */
  async untilCalls(count: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (this.requests.length < count) {
      if (Date.now() > deadline) throw new Error(`el proveedor recibió ${this.requests.length} peticiones, se esperaban ${count}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
