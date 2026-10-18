import type { Point } from '@/lib/editor/canvas-geometry';
import type { Problem } from '@/lib/editor/issues-view';
import type { EditResult, FlowDoc, Change } from '@/lib/editor/json-edit';

/** Lo que necesita un campo del inspector o del panel del flujo (sin React: se pasa por propiedades). */
export interface FieldContext {
  /** El borrador. */
  flow: FlowDoc;
  /** Nodo del inspector, o `null` en el panel del flujo. */
  nodeId: string | null;
  /** Puntero del nodo en el flujo (`/nodes/3`), o `''` en el panel del flujo. */
  nodeBase: string;
  /** Posición con la que se pinta cada nodo (para fijarlas al conectar). */
  positions: ReadonlyMap<string, Point>;
  /** Ids de los nodos, en el orden de `nodes`, para los selectores de salto. */
  nodeIds: readonly string[];
  /** Problemas y avisos del veredicto actual. */
  problems: readonly Problem[];
  /** Aplica una edición al borrador. */
  edit: (change: Change) => EditResult;
  /** Renombra un nodo y sigue la selección. */
  rename: (from: string, to: string) => EditResult;
}
