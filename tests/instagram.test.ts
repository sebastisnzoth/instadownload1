import assert from 'node:assert/strict';
import test from 'node:test';
import { extractInstagramUrls, parseInstagramUrl, normalizeInstagramUsername, toCsv } from '../src/lib/instagram';

test('normaliza enlaces de publicaciones y reels', () => {
  assert.equal(parseInstagramUrl('https://www.instagram.com/reels/AbC_123/?utm_source=x')?.canonicalUrl, 'https://www.instagram.com/reel/AbC_123/');
  assert.equal(parseInstagramUrl('https://instagram.com/p/xyz/')?.kind, 'p');
});

test('deduplica enlaces pegados en distintas formas', () => {
  const items = extractInstagramUrls('https://instagram.com/p/xyz/?foo=bar\nhttps://www.instagram.com/p/xyz/');
  assert.equal(items.length, 1);
});

test('normaliza cuentas y rechaza rutas reservadas', () => {
  assert.equal(normalizeInstagramUsername('@Ejemplo.2026'), 'ejemplo.2026');
  assert.equal(normalizeInstagramUsername('https://instagram.com/explore/'), null);
});

test('escapa comillas y comas en CSV', () => {
  assert.equal(toCsv([['a,b', 'a"b']]), '"a,b","a""b"');
});
