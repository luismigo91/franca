/* Generado desde flow.schema.json con `pnpm generate`. No editar a mano. */

/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "id".
 */
export type Id = string;
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "varName".
 */
export type VarName = string;
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "node".
 */
export type Node = MessageNode | InputNode | ConditionNode | SetNode | HttpNode | LlmNode | JumpNode | EndNode;
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "messageNode".
 */
export type MessageNode = NodeBase & {
  type?: 'message';
  content: Content;
  next: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "contentItem".
 */
export type ContentItem =
  | {
      kind: 'text';
      text: Template;
    }
  | {
      kind: 'image' | 'video' | 'audio' | 'embed';
      url: Template;
      alt?: string;
    };
/**
 * Texto que admite variables con la forma {{nombre}}.
 *
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "template".
 */
export type Template = string;
/**
 * @minItems 1
 *
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "content".
 */
export type Content = ContentItem[];
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "inputNode".
 */
export type InputNode = NodeBase & {
  type?: 'input';
  prompt: Content;
  inputType: 'text' | 'email' | 'phone' | 'number' | 'url' | 'date' | 'boolean' | 'choice';
  variable: VarName;
  placeholder?: string;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    retryMessage?: Template;
    maxRetries?: number;
  };
  /**
   * @minItems 1
   */
  choices?: {
    id: Id;
    label: Template;
    value?: string | number | boolean;
    imageUrl?: Template;
    next?: Id;
  }[];
  multiple?: boolean;
  next?: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "conditionNode".
 */
export type ConditionNode = NodeBase & {
  type?: 'condition';
  /**
   * @minItems 1
   */
  rules: {
    when: Predicate;
    next: Id;
  }[];
  else: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "predicate".
 */
export type Predicate =
  | Rule
  | {
      /**
       * @minItems 1
       */
      all: Predicate[];
    }
  | {
      /**
       * @minItems 1
       */
      any: Predicate[];
    };
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "setNode".
 */
export type SetNode = NodeBase & {
  type?: 'set';
  /**
   * @minItems 1
   */
  assignments: {
    variable: VarName;
    value: string | number | boolean | null;
  }[];
  next: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "httpNode".
 */
export type HttpNode = NodeBase & {
  type?: 'http';
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: Template;
    headers?: {
      [k: string]: Template | SecretRef;
    };
    /**
     * JSON libre; las cadenas admiten plantillas.
     */
    body?: {
      [k: string]: unknown;
    };
  };
  timeoutMs?: number;
  retries?: number;
  responseMap?: {
    variable: VarName;
    /**
     * JSON Pointer (RFC 6901) sobre el cuerpo de la respuesta.
     */
    pointer: string;
  }[];
  next: Id;
  onError: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "llmNode".
 */
export type LlmNode = NodeBase & {
  type?: 'llm';
  /**
   * Nombre de un proveedor configurado en la instalación.
   */
  provider: string;
  model?: string;
  system?: Template;
  goal: Template;
  slots?: {
    variable: VarName;
    description: string;
    required?: boolean;
  }[];
  maxTurns?: number;
  costCapUsd?: number;
  temperature?: number;
  next: Id;
  onExhausted: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "jumpNode".
 */
export type JumpNode = NodeBase & {
  type?: 'jump';
  target: Id;
};
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "endNode".
 */
export type EndNode = NodeBase & {
  type?: 'end';
  content?: Content;
  outcome?: Id;
};

/**
 * Flujo conversacional de Franca. Borrador v0 (RFC-0001).
 */
export interface Flow {
  specVersion: '0.1';
  id: Id;
  name: string;
  description?: string;
  locale?: string;
  settings?: Settings;
  variables?: Variable[];
  start: Id;
  /**
   * @minItems 1
   */
  nodes: Node[];
}
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "settings".
 */
export interface Settings {
  typingDelayMs?: number;
  sessionTimeoutMinutes?: number;
}
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "variable".
 */
export interface Variable {
  name: VarName;
  type: 'string' | 'number' | 'boolean' | 'date' | 'email' | 'phone' | 'url' | 'json';
  scope?: 'session' | 'contact';
  pii?: boolean;
  description?: string;
  default?: unknown;
}
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "nodeBase".
 */
export interface NodeBase {
  id: Id;
  type: string;
  title?: string;
  position?: Position;
}
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "position".
 */
export interface Position {
  x: number;
  y: number;
}
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "rule".
 */
export interface Rule {
  variable: VarName;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'matches' | 'isSet' | 'isEmpty';
  value?: unknown;
}
/**
 * This interface was referenced by `Flow`'s JSON-Schema
 * via the `definition` "secretRef".
 */
export interface SecretRef {
  secret: string;
}
