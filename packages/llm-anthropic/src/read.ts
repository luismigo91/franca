/** Lee una propiedad sin fiarse del objeto: lo que no es un objeto, o cuyo getter lanza, no tiene valor. */
export function readProperty(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
