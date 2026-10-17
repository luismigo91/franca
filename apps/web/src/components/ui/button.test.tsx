import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('el JSX se transforma sin importar React y el botón no envía formularios por defecto', () => {
    const html = renderToStaticMarkup(<Button>Probar</Button>);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('>Probar</button>');
  });

  it('respeta type, disabled y el nombre accesible', () => {
    const html = renderToStaticMarkup(
      <Button type="submit" disabled aria-label="Probar Captación de leads">
        Probar
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-label="Probar Captación de leads"');
  });
});
