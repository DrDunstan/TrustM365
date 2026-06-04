import { afterEach, describe, expect, it } from 'vitest';
import { applyBrandHue } from './App.jsx';

describe('applyBrandHue', () => {
  afterEach(() => {
    document.getElementById('brand-hue-override')?.remove();
  });

  it('creates style override with brand CSS variables when hue is provided', () => {
    applyBrandHue('210');

    const styleEl = document.getElementById('brand-hue-override');
    expect(styleEl).toBeTruthy();
    expect(styleEl.textContent).toContain('--brand-500:hsl(210,80%,63%)');
    expect(styleEl.textContent).toContain('--brand-900:hsl(210,62%,20%)');
  });

  it('removes style override when hue is empty', () => {
    applyBrandHue('120');
    expect(document.getElementById('brand-hue-override')).toBeTruthy();

    applyBrandHue('');
    expect(document.getElementById('brand-hue-override')).toBeNull();
  });
});
