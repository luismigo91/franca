// Precarga de los e2e del proceso real (`node --import`): sustituye `fetch` antes de que arranque la API. Nada sale a la
// red: cada llamada se registra en `stderr` (solo URL, método, nombres de cabeceras y dos booleanos, nunca valores) y
// responde un 400 de la API de Mensajes para que el SDK no reintente.
const SENTINELS = (process.env.QA6_SENTINELS ?? '').split('|').filter(Boolean);
const EXPECTED_KEY = process.env.FRANCA_ANTHROPIC_API_KEY ?? '';

globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const names = [...headers.keys()].sort();
  const values = [...headers.values()].join('\n');
  const record = {
    url:
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    method: init?.method ?? 'GET',
    names,
    keyOk: headers.get('x-api-key') === EXPECTED_KEY && EXPECTED_KEY !== '',
    leaked: SENTINELS.filter((sentinel) => values.includes(sentinel)),
  };
  process.stderr.write(`QA6-FETCH ${JSON.stringify(record)}\n`);
  return new Response(
    JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'qa6' },
    }),
    {
      status: 400,
      headers: { 'content-type': 'application/json' },
    },
  );
};
