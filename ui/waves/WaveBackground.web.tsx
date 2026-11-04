import { createElement, useEffect, useState } from 'react';
import { RIPPLE_DECAY, STILL_TIME, WAVES_GLSL, WAVES_VERTEX_GLSL } from './shader';

/** Render below device resolution: the image is all soft gradients, and grain hides the upscale. */
const RENDER_SCALE = 0.6;
const MAX_DPR = 2;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[halcyx] wave shader:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * Animated "dark silk" backdrop (WebGL). Pauses when the tab is hidden, renders one still
 * frame for reduced motion, and falls back to plain black if WebGL is unavailable.
 */
export function WaveBackground({ reduceMotion = false }: { reduceMotion?: boolean; pointer?: unknown }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, WAVES_VERTEX_GLSL);
    const fs = compile(gl, gl.FRAGMENT_SHADER, WAVES_GLSL);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, 'uRes'),
      time: gl.getUniformLocation(prog, 'uTime'),
      ptr: gl.getUniformLocation(prog, 'uPointer'),
      amt: gl.getUniformLocation(prog, 'uPointerAmt'),
      grain: gl.getUniformLocation(prog, 'uGrain'),
    };
    gl.uniform1f(u.grain, 1);

    let scale = 1;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * RENDER_SCALE;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      scale = dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(u.res, w, h);
    };

    // Pointer ripple: eased position, intensity that rises on movement and decays exponentially.
    const target = { x: 0, y: 0 };
    const ptr = { x: 0, y: 0 };
    let amt = 0;
    let hasPointer = false;
    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      target.x = (e.clientX - rect.left) * scale;
      target.y = (rect.bottom - e.clientY) * scale; // gl_FragCoord origin is bottom-left
      if (!hasPointer) {
        ptr.x = target.x;
        ptr.y = target.y;
        hasPointer = true;
      }
      amt = Math.min(1, amt + (e.pointerType === 'mouse' ? 0.08 : 0.5));
    };

    const draw = (time: number) => {
      resize();
      gl.uniform1f(u.time, time);
      gl.uniform2f(u.ptr, ptr.x, ptr.y);
      gl.uniform1f(u.amt, amt);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    if (reduceMotion) {
      draw(STILL_TIME);
      const onResize = () => draw(STILL_TIME);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let raf = 0;
    let last = performance.now();
    const start = last - STILL_TIME * 1000; // open on a composed frame, not t = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = 1 - Math.exp(-dt * 6);
      ptr.x += (target.x - ptr.x) * k;
      ptr.y += (target.y - ptr.y) * k;
      amt *= Math.exp(-dt * RIPPLE_DECAY);
      draw((now - start) / 1000);
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', () => cancelAnimationFrame(raf));
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [canvas, reduceMotion]);

  return createElement('canvas', {
    ref: setCanvas,
    'aria-hidden': true,
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', background: '#000', pointerEvents: 'none' },
  });
}
