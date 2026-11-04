import { describe, expect, it } from 'vitest';
import { brand } from '@airwheels/ui';

// Logic-level tests run in Vitest. UI flows run in Maestro (.maestro/).
describe('driver theme', () => {
  it('uses the Airwheels coral for primary actions', () => {
    expect(brand.coral).toBe('#FF4D3D');
  });
});
