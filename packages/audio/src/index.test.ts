import { describe, it, expect } from 'vitest';
import * as audio from './index.js';

describe('@omega/audio public exports', () => {
  it('exports the spatial mixer', () => {
    expect(typeof audio.SpatialMixer).toBe('function');
  });

  it('exports the ambience generator', () => {
    expect(typeof audio.AmbienceGenerator).toBe('function');
  });

  it('exports reverb models', () => {
    expect(typeof audio.DryReverb).toBe('function');
    expect(typeof audio.SimpleConvolutionReverb).toBe('function');
  });

  it('exposes the shared types via runtime constructors', () => {
    const mixer = new audio.SpatialMixer();
    const amb = new audio.AmbienceGenerator({ seed: 1 });
    const dry = new audio.DryReverb();
    expect(mixer).toBeInstanceOf(audio.SpatialMixer);
    expect(amb).toBeInstanceOf(audio.AmbienceGenerator);
    expect(dry).toBeInstanceOf(audio.DryReverb);
  });
});
