import { Button } from '@/components/ui/button';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 1.25;

const PERCENT = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 0 });

/** Limita el zoom al rango 0,5 a 2. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Reducir, ampliar y tamaño real: solo botones (sin Ctrl/⌘ + rueda, D9). */
export function ZoomControls({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Zoom del lienzo">
      <Button variant="secondary" className="min-h-9 px-3" onClick={() => onChange(clampZoom(zoom / ZOOM_STEP))}>
        Reducir
      </Button>
      <Button variant="secondary" className="min-h-9 px-3" onClick={() => onChange(clampZoom(zoom * ZOOM_STEP))}>
        Ampliar
      </Button>
      <Button variant="secondary" className="min-h-9 px-3" onClick={() => onChange(1)}>
        Tamaño real
      </Button>
      <span className="text-sm opacity-70">
        {PERCENT.format(zoom)}
      </span>
    </div>
  );
}
