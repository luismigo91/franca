/** Token de inyección del reloj: los e2e lo sustituyen por uno que avanza 1 ms por llamada. */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

/** El reloj real. Las fechas las escribe el servicio, nunca `now()` de Postgres, para que un `PUT` sin cambios no escriba nada. */
export const systemClock: Clock = { now: () => new Date() };
