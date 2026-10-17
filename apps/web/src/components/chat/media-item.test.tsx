import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaItem } from '@/components/chat/media-item';
import { readEvents } from '@/lib/chat/events';
import { FLOWS, runFlow } from '../../../tests/helpers/engine-events';

const render = (item: Parameters<typeof MediaItem>[0]['item']) => renderToStaticMarkup(<MediaItem item={item} />);

describe('MediaItem', () => {
  it('el src es el href serializado, nunca el texto original', () => {
    const html = render({ kind: 'image', url: 'HTTPS://Example.COM/a.png', alt: 'Logo' });
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).not.toContain('HTTPS://Example.COM');
  });

  it('la imagen lleva alt, sin Referer y carga diferida', () => {
    const html = render({ kind: 'image', url: 'https://example.com/logo.png', alt: 'Logo' });
    expect(html).toContain('alt="Logo"');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('loading="lazy"');
    expect(render({ kind: 'image', url: 'https://example.com/logo.png' })).toContain('alt=""');
  });

  it('el iframe tiene el sandbox exacto: sin allow-same-origin, allow-top-navigation*, allow-popups ni allow-forms', () => {
    const html = render({ kind: 'embed', url: 'https://example.com/widget', alt: 'Widget' });
    expect(html).toContain('sandbox="allow-scripts"');
    for (const forbidden of ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms', 'allow-modals']) expect(html).not.toContain(forbidden);
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('title="Widget"');
    expect(render({ kind: 'embed', url: 'https://example.com/widget' })).toContain('title="Contenido incrustado"');
  });

  it('audio y vídeo con controles nativos y aria-label si hay alt', () => {
    const audio = render({ kind: 'audio', url: 'https://example.com/audio.mp3', alt: 'Saludo' });
    expect(audio).toContain('<audio');
    expect(audio).toContain('controls');
    expect(audio).toContain('aria-label="Saludo"');
    expect(audio).toContain('src="https://example.com/audio.mp3"');
    const video = render({ kind: 'video', url: 'http://example.com/a.mp4' });
    expect(video).toContain('<video');
    expect(video).toContain('src="http://example.com/a.mp4"');
    expect(video).not.toContain('aria-label');
  });

  it('una dirección no admitida muestra «Contenido no disponible» y su alt, sin cargar nada', () => {
    for (const [kind, url] of [
      ['image', 'javascript:alert(1)'],
      ['image', '/relativa.png'],
      ['image', 'https://usuario:clave@example.com/a.png'],
      ['video', 'data:video/mp4;base64,AAAA'],
      ['embed', 'http://example.com/widget'],
    ] as const) {
      const html = render({ kind, url, alt: 'Malo' });
      expect(html, `${kind} ${url}`).toContain('Contenido no disponible');
      expect(html).toContain('Malo');
      for (const tag of ['<img', '<video', '<audio', '<iframe', 'src=', 'href=']) expect(html).not.toContain(tag);
    }
    expect(render({ kind: 'image', url: 'javascript:alert(1)' })).not.toContain('alt');
  });

  it('del flujo medios, con los eventos reales: tres elementos admitidos y cinco «Contenido no disponible»', async () => {
    const [first] = await runFlow(FLOWS.medios);
    const message = readEvents(first!.events).find((event) => event.type === 'message');
    if (message?.type !== 'message') throw new Error('sin mensaje');
    const html = message.content.flatMap((item) => (item.kind === 'text' ? [] : [render(item)])).join('');
    expect(html.match(/Contenido no disponible/g)).toHaveLength(5);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html.match(/<audio /g)).toHaveLength(1);
    expect(html.match(/<iframe /g)).toHaveLength(1);
    expect(html).not.toContain('javascript:');
  });
});
