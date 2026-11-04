import { createRequire } from 'node:module';
import { WAVES_GLSL, WAVES_SKSL } from '@/ui/waves/shader';

/**
 * The native backdrop is a Skia runtime shader; a compile error would only show up on a
 * device. CanvasKit is the same Skia shader compiler, so compile (and render) it here.
 */
type CanvasKit = {
  RuntimeEffect: {
    Make(sksl: string, onError?: (e: string) => void): { makeShader(u: number[]): unknown; getUniformCount(): number } | null;
  };
  MakeSurface(
    w: number,
    h: number,
  ): {
    getCanvas(): { drawRect(r: unknown, p: unknown): void };
    makeImageSnapshot(): { readPixels(x: number, y: number, info: unknown): Uint8Array };
  };
  Paint: new () => { setShader(s: unknown): void };
  LTRBRect(l: number, t: number, r: number, b: number): unknown;
  ColorType: { RGBA_8888: unknown };
  AlphaType: { Unpremul: unknown };
  ColorSpace: { SRGB: unknown };
};

const req = createRequire(__filename);

async function canvasKit(): Promise<CanvasKit> {
  const init = req('canvaskit-wasm/bin/full/canvaskit.js') as (o: { locateFile(f: string): string }) => Promise<CanvasKit>;
  return init({ locateFile: (f) => req.resolve(`canvaskit-wasm/bin/full/${f}`) });
}

describe('sign-in wave shader', () => {
  jest.setTimeout(30_000);

  it('compiles for Skia and renders a mostly-black, never-blown-out frame', async () => {
    const CK = await canvasKit();
    let error = '';
    const effect = CK.RuntimeEffect.Make(WAVES_SKSL, (e) => (error = e));
    expect(error).toBe('');
    expect(effect).not.toBeNull();
    expect(effect!.getUniformCount()).toBe(5);

    const [w, h] = [120, 260];
    const surface = CK.MakeSurface(w, h);
    const paint = new CK.Paint();
    paint.setShader(effect!.makeShader([w, h, 20, 60, 130, 0.8, 1]));
    surface.getCanvas().drawRect(CK.LTRBRect(0, 0, w, h), paint);
    const px = surface.makeImageSnapshot().readPixels(0, 0, {
      width: w,
      height: h,
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    });

    let sum = 0;
    let max = 0;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
      sum += l;
      max = Math.max(max, l);
      if (l > 12) lit += 1;
    }
    const mean = sum / (w * h);
    expect(mean).toBeLessThan(28); // pitch black overall: text stays readable on top
    expect(max).toBeLessThan(200); // highlights stay subtle
    expect(lit).toBeGreaterThan(0); // but the waves are actually there
  });

  it('shares one wave function between the WebGL and Skia versions', () => {
    for (const src of [WAVES_GLSL, WAVES_SKSL]) {
      expect(src).toContain('float3 halcyxWaves(');
      for (const u of ['uRes', 'uTime', 'uPointer', 'uPointerAmt', 'uGrain']) expect(src).toContain(u);
    }
    expect(WAVES_GLSL).toContain('#define float2 vec2');
  });
});
