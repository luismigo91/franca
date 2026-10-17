import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageText } from '@/components/chat/message-text';

describe('MessageText', () => {
  it('pinta el HTML y las direcciones como texto: ni b ni a, ni enlaces automáticos', () => {
    const html = renderToStaticMarkup(<MessageText text={'<b>Hola</b>\nhttps://example.com'} />);
    expect(html).toContain('&lt;b&gt;Hola&lt;/b&gt;\nhttps://example.com');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<a>');
    expect(html).not.toContain('href=');
  });

  it('conserva los saltos de línea y los espacios con white-space: pre-wrap y rompe en 320 px', () => {
    const html = renderToStaticMarkup(<MessageText text={' Ana '} />);
    expect(html).toContain('> Ana </p>');
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('[overflow-wrap:anywhere]');
  });

  it('no interpreta Markdown ni imágenes', () => {
    const html = renderToStaticMarkup(<MessageText text={'**negrita** [x](https://example.com) ![img](https://example.com/a.png)'} />);
    expect(html).toContain('**negrita** [x](https://example.com) ![img](https://example.com/a.png)');
    expect(html).not.toContain('<strong');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a');
  });

  it('una respuesta vacía lleva la marca visual en aria-hidden y el nombre accesible «Respuesta vacía»', () => {
    const html = renderToStaticMarkup(<MessageText text="" />);
    expect(html).toContain('<span class="sr-only">Respuesta vacía</span>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('(vacía)');
  });

  it('un texto de solo espacios no es una respuesta vacía', () => {
    const html = renderToStaticMarkup(<MessageText text="   " />);
    expect(html).not.toContain('(vacía)');
    expect(html).toContain('>   </p>');
  });
});
