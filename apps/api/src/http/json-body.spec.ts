import { describe, expect, it } from 'vitest';
import { decodeUtf8, isAcceptedContentType } from './json-body.js';

describe('isAcceptedContentType', () => {
  it.each([
    'application/json',
    'Application/JSON',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
    'application/json; charset="utf-8"',
    'application/json ;  charset = utf-8 ',
  ])('admite %s', (header) => {
    expect(isAcceptedContentType(header)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'text/plain',
    'application/jsonx',
    'application/vnd.api+json',
    'application/json; charset=latin1',
    'application/json; charset=utf8',
    'application/json; boundary=x',
    'application/json; charset=utf-8; charset=utf-8',
    'application/json;',
    'application/json; charset="utf-8',
    'multipart/form-data; boundary=x',
  ])('rechaza %j', (header) => {
    expect(isAcceptedContentType(header)).toBe(false);
  });
});

describe('decodeUtf8', () => {
  it('decodifica UTF-8 válido, también multibyte', () => {
    expect(decodeUtf8(new TextEncoder().encode('{"a":"Captación \u{1f600}"}'))).toBe('{"a":"Captación \u{1f600}"}');
  });

  it('rechaza bytes que no son UTF-8', () => {
    expect(decodeUtf8(Uint8Array.from([0x7b, 0xff, 0x7d]))).toBeUndefined();
    expect(decodeUtf8(Uint8Array.from([0xc3]))).toBeUndefined();
  });

  it('conserva el BOM para que JSON.parse lo rechace', () => {
    const text = decodeUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    expect(text).toBe('﻿{}');
    expect(() => JSON.parse(text!)).toThrow();
  });
});
