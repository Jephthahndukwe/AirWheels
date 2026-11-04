import { describe, expect, it } from 'vitest';
import { brand, resolveTheme } from './tokens';

describe('tokens', () => {
  it('keeps the brand colours from the PRD', () => {
    expect(brand.coral).toBe('#FF4D3D');
    expect(brand.ink).toBe('#14141A');
    expect(brand.cloud).toBe('#F4F5F7');
    expect(brand.slate).toBe('#6B7280');
  });
  it('lets an airline override the primary colour only', () => {
    const t = resolveTheme({ primary: '#003399', serviceName: 'Mock Air Transfers' });
    expect(t.primary).toBe('#003399');
    expect(t.foreground).toBe(brand.ink);
  });
});
