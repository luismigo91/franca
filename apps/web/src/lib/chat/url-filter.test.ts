import { describe, expect, it } from 'vitest';
import { admitUrl } from '@/lib/chat/url-filter';

describe('admitUrl', () => {
  it('Direcciones rechazadas', () => {
    const rejected: [string, Parameters<typeof admitUrl>[1]][] = [
      ['javascript:alert(1)', 'image'],
      ['JavaScript:alert(1)', 'image'],
      ['java\nscript:alert(1)', 'image'],
      ['data:image/png;base64,AAAA', 'image'],
      ['blob:https://example.com/x', 'image'],
      ['file:///etc/hosts', 'image'],
      ['/relativa.png', 'image'],
      ['//example.com/a.png', 'image'],
      ['https://usuario:clave@example.com/a.png', 'image'],
      ['http://example.com/widget', 'embed'],
    ];
    for (const [raw, kind] of rejected) expect(admitUrl(raw, kind), `${kind}: ${JSON.stringify(raw)}`).toBeNull();
  });

  it('Direcciones admitidas y su serialización', () => {
    expect(admitUrl('HTTPS://Example.COM/a.png', 'image')).toBe('https://example.com/a.png');
    expect(admitUrl('http://example.com/a.mp3', 'audio')).toBe('http://example.com/a.mp3');
  });

  it('rechaza cada esquema peligroso en cada elemento', () => {
    for (const kind of ['image', 'video', 'audio', 'embed', 'option-image'] as const) {
      for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'blob:https://example.com/x', 'file:///x', 'ftp://example.com/x', 'vbscript:x', 'about:blank']) {
        expect(admitUrl(raw, kind), `${kind} ${raw}`).toBeNull();
      }
    }
  });

  it('rechaza las credenciales aunque solo haya usuario o contraseña vacíos con arroba', () => {
    expect(admitUrl('https://usuario@example.com/a.png', 'image')).toBeNull();
    expect(admitUrl('https://:clave@example.com/a.png', 'image')).toBeNull();
  });

  it('http: se admite salvo en embed; https: en todo', () => {
    for (const kind of ['image', 'video', 'audio', 'option-image'] as const) expect(admitUrl('http://example.com/x', kind)).toBe('http://example.com/x');
    expect(admitUrl('http://example.com/x', 'embed')).toBeNull();
    expect(admitUrl('https://example.com/x', 'embed')).toBe('https://example.com/x');
  });

  it('lo que no es un texto no se admite', () => {
    for (const raw of [undefined, null, 12, {}, ['https://example.com/a.png'], true]) expect(admitUrl(raw, 'image')).toBeNull();
  });

  it('con un tabulador o salto de línea dentro de un esquema válido pinta el href limpio, nunca el texto', () => {
    expect(admitUrl('ht\ntps://example.com/a\t.png', 'image')).toBe('https://example.com/a.png');
  });

  it('de los casos de medios y preguntas: la imagen de la opción Pro no se admite y la de Básico sí', () => {
    expect(admitUrl('https://example.com/basico.png', 'option-image')).toBe('https://example.com/basico.png');
    expect(admitUrl('javascript:alert(1)', 'option-image')).toBeNull();
    expect(admitUrl('https://example.com/widget', 'embed')).toBe('https://example.com/widget');
    expect(admitUrl('data:video/mp4;base64,AAAA', 'video')).toBeNull();
    expect(admitUrl('https://example.com/audio.mp3', 'audio')).toBe('https://example.com/audio.mp3');
  });
});
