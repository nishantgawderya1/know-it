import { describe, expect, it } from 'vitest';
import { DomainLimiter, hostOf } from './politeness.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('hostOf', () => {
  it('normalises the host so www and apex share one budget', () => {
    expect(hostOf('https://www.economictimes.indiatimes.com/markets')).toBe(
      'economictimes.indiatimes.com',
    );
  });

  it('does not throw on a malformed URL', () => {
    expect(hostOf('nonsense')).toBe('unknown');
  });
});

describe('DomainLimiter', () => {
  it('serialises requests to the same host', async () => {
    // ET's section feeds share a domain, as do the article pages we then fetch from it.
    const limiter = new DomainLimiter({ minGapMs: 0 });
    const events: string[] = [];

    const task = (label: string) => async () => {
      events.push(`${label}:start`);
      await tick();
      events.push(`${label}:end`);
    };

    await Promise.all([
      limiter.run('example.com', task('a')),
      limiter.run('example.com', task('b')),
    ]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different hosts run concurrently', async () => {
    const limiter = new DomainLimiter({ minGapMs: 0 });
    const events: string[] = [];

    const task = (label: string) => async () => {
      events.push(`${label}:start`);
      await tick();
      events.push(`${label}:end`);
    };

    await Promise.all([limiter.run('a.com', task('a')), limiter.run('b.com', task('b'))]);

    // Both start before either finishes.
    expect(events.slice(0, 2).sort()).toEqual(['a:start', 'b:start']);
  });

  it('keeps the chain alive after a task throws', async () => {
    // One failing publisher must not wedge every later request to that host.
    const limiter = new DomainLimiter({ minGapMs: 0 });
    await expect(
      limiter.run('example.com', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(limiter.run('example.com', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('backs off further on each consecutive throttle', () => {
    const limiter = new DomainLimiter({ minGapMs: 100 });
    const first = limiter.penalise('example.com');
    const second = limiter.penalise('example.com');
    expect(second).toBeGreaterThan(first);
  });

  it('caps backoff', () => {
    const limiter = new DomainLimiter({ minGapMs: 100, maxBackoffMs: 500 });
    for (let i = 0; i < 20; i += 1) limiter.penalise('example.com');
    expect(limiter.backoffMs('example.com')).toBeLessThanOrEqual(500);
  });

  it('clears backoff after a clean response', () => {
    const limiter = new DomainLimiter({ minGapMs: 100 });
    limiter.penalise('example.com');
    limiter.penalise('example.com');
    limiter.reward('example.com');
    expect(limiter.penalise('example.com')).toBe(200);
  });
});
