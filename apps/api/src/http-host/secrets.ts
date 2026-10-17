/** Un secreto de la instalación: el valor completo de la cabecera y los orígenes exactos que pueden recibirlo. */
export interface InstalledSecret {
  readonly value: string;
  readonly origins: ReadonlySet<string>;
}

export type SecretLookup = { readonly kind: 'found'; readonly value: string } | { readonly kind: 'not_configured' } | { readonly kind: 'origin_not_allowed' };

export interface SecretStore {
  /**
   * @param name El nombre del secreto (`secretRef` del nodo).
   * @param origin El origen de la `url` (`new URL(url).origin`), comparado como texto exacto.
   */
  lookup(name: string, origin: string): SecretLookup;
}

/**
 * Almacén de secretos de **un** host (la API tiene uno para la instalación; el arnés de conformidad, uno por tenant).
 * Lee del mapa en cada consulta: quien lo mantiene puede añadir secretos después de crear el host.
 *
 * @param secrets Nombre → secreto.
 * @returns El almacén.
 */
export function createSecretStore(secrets: ReadonlyMap<string, InstalledSecret>): SecretStore {
  return {
    lookup(name, origin) {
      const secret = secrets.get(name);
      if (secret === undefined) return { kind: 'not_configured' };
      if (!secret.origins.has(origin)) return { kind: 'origin_not_allowed' };
      return { kind: 'found', value: secret.value };
    },
  };
}
