import { describe, expect, it } from 'vitest';
import {
  firstImageInHtml,
  isJunkImageUrl,
  normaliseImageUrl,
  parseDimension,
  selectLeadImage,
  type ImageCandidate,
} from './image.js';

const PAGE = 'https://www.livemint.com/economy/rbi-holds-rates';

describe('normaliseImageUrl', () => {
  it('absolutises the relative forms feeds actually ship', () => {
    // Losing these would cost us images on whole publishers, not individual articles.
    expect(normaliseImageUrl('//img.cdn.com/a.jpg', PAGE)).toBe('https://img.cdn.com/a.jpg');
    expect(normaliseImageUrl('/static/a.jpg', PAGE)).toBe('https://www.livemint.com/static/a.jpg');
    expect(normaliseImageUrl('a.jpg', PAGE)).toBe('https://www.livemint.com/economy/a.jpg');
  });

  it('strips the fragment so one image is one URL', () => {
    expect(normaliseImageUrl('https://c.com/a.jpg#x', PAGE)).toBe('https://c.com/a.jpg');
  });

  it('rejects data URIs rather than storing base64 in a text column', () => {
    expect(normaliseImageUrl('data:image/gif;base64,R0lGODlhAQ', PAGE)).toBeNull();
  });

  it('rejects non-http schemes and unusable input', () => {
    expect(normaliseImageUrl('javascript:alert(1)', PAGE)).toBeNull();
    expect(normaliseImageUrl('', PAGE)).toBeNull();
    expect(normaliseImageUrl('   ', PAGE)).toBeNull();
    expect(normaliseImageUrl(null, PAGE)).toBeNull();
    expect(normaliseImageUrl(undefined, PAGE)).toBeNull();
  });
});

describe('parseDimension', () => {
  it('accepts the number, string and "px" forms feeds mix freely', () => {
    expect(parseDimension(640)).toBe(640);
    expect(parseDimension('640')).toBe(640);
    expect(parseDimension('640px')).toBe(640);
    expect(parseDimension('640.5')).toBe(641);
  });

  it('returns null for absent or nonsense values', () => {
    expect(parseDimension(undefined)).toBeNull();
    expect(parseDimension('auto')).toBeNull();
    expect(parseDimension(0)).toBeNull();
    expect(parseDimension(-5)).toBeNull();
  });
});

describe('isJunkImageUrl', () => {
  it('catches the tracking and placeholder shapes', () => {
    expect(isJunkImageUrl('https://c.com/pixel.gif')).toBe(true);
    expect(isJunkImageUrl('https://c.com/img/1x1.png')).toBe(true);
    expect(isJunkImageUrl('https://c.com/assets/placeholder.jpg')).toBe(true);
    expect(isJunkImageUrl('https://c.com/default-image.png')).toBe(true);
    expect(isJunkImageUrl('https://c.com/logo_dark.svg')).toBe(true);
  });

  it('does not over-match real photography', () => {
    // Over-matching drops real images silently, which is worse than a wrong image.
    expect(isJunkImageUrl('https://c.com/2026/08/rbi-governor-1200x675.jpg')).toBe(false);
    expect(isJunkImageUrl('https://c.com/photo/sensex-rally.webp')).toBe(false);
  });
});

describe('selectLeadImage', () => {
  it('prefers the widest image within the best available tier', () => {
    const candidates: ImageCandidate[] = [
      { url: 'https://c.com/small.jpg', source: 'media_content', width: 320 },
      { url: 'https://c.com/large.jpg', source: 'media_content', width: 1200 },
      { url: 'https://c.com/og.jpg', source: 'og', width: 2000 },
    ];
    const picked = selectLeadImage(candidates, PAGE);
    expect(picked?.url).toBe('https://c.com/large.jpg');
    expect(picked?.source).toBe('media_content');
  });

  it('falls through to the next tier when the first is all junk', () => {
    const candidates: ImageCandidate[] = [
      { url: 'https://c.com/pixel.gif', source: 'media_content', width: 1, height: 1 },
      { url: 'https://c.com/real.jpg', source: 'og', width: 800 },
    ];
    expect(selectLeadImage(candidates, PAGE)?.source).toBe('og');
  });

  it('keeps images of unknown size — most feeds omit dimensions entirely', () => {
    const picked = selectLeadImage([{ url: 'https://c.com/a.jpg', source: 'enclosure' }], PAGE);
    expect(picked?.url).toBe('https://c.com/a.jpg');
    expect(picked?.width).toBeNull();
  });

  it('rejects known-tiny images that would render as a smudge', () => {
    const candidates: ImageCandidate[] = [
      { url: 'https://c.com/icon.png', source: 'media_content', width: 64, height: 64 },
    ];
    expect(selectLeadImage(candidates, PAGE)).toBeNull();
  });

  it('returns null rather than throwing when nothing is usable', () => {
    expect(selectLeadImage([], PAGE)).toBeNull();
    expect(selectLeadImage([{ url: 'not a url', source: 'og' }], PAGE)).toBeNull();
  });
});

describe('firstImageInHtml', () => {
  it('picks the first real image out of a content:encoded fragment', () => {
    const html = '<p>Text</p><img src="https://c.com/story.jpg" width="800"/><p>More</p>';
    expect(firstImageInHtml(html)).toBe('https://c.com/story.jpg');
  });

  it('skips the tracking pixel that precedes the real image', () => {
    const html = '<img src="https://c.com/pixel.gif"/><img src="https://c.com/story.jpg"/>';
    expect(firstImageInHtml(html)).toBe('https://c.com/story.jpg');
  });

  it('prefers data-src, because lazy loaders put a spacer in src', () => {
    const html = '<img src="data:image/gif;base64,R0lG" data-src="https://c.com/real.jpg"/>';
    expect(firstImageInHtml(html)).toBe('https://c.com/real.jpg');
  });

  it('returns null for text-only content', () => {
    expect(firstImageInHtml('<p>No pictures here.</p>')).toBeNull();
    expect(firstImageInHtml(null)).toBeNull();
    expect(firstImageInHtml('')).toBeNull();
  });
});
