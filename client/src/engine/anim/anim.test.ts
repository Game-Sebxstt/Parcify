import { describe, expect, it } from 'vitest';
import type { Animation } from '../../shared/document/schema.js';
import { AnimationCommands } from '../commands/animation.ts';
import { makeCore, putNode, rect } from '../test-utils.ts';
import { cubicBezier, EASING_CURVES, easingFn } from './easing.ts';
import { hexToOklab, mixOklab, oklabToHex } from './oklab.ts';
import { compileAnimation, effectiveDuration, poseAt, progressAt, sampleColor, sampleNumber, type CompiledTrack } from './timeline.ts';

// Inversa de x(t) por bisección densa, como referencia para el solver.
function reference([x1, y1, x2, y2]: readonly number[], x: number): number {
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (at(mid, x1!, x2!) < x) low = mid;
    else high = mid;
  }
  return at((low + high) / 2, y1!, y2!);
}

const animation = (tracks: Animation['tracks'], settings: Partial<Omit<Animation, 'tracks'>> = {}): Animation => ({
  duration: 1000,
  delay: 0,
  loop: 1,
  direction: 'normal',
  autoplay: 'none',
  tracks,
  ...settings,
});

describe('easing', () => {
  it('linear y step', () => {
    expect(easingFn('linear')(0.3)).toBe(0.3);
    expect(easingFn('step')(0)).toBe(0);
    expect(easingFn('step')(0.999)).toBe(0);
    expect(easingFn('step')(1)).toBe(1);
  });

  it.each(Object.entries(EASING_CURVES))('%s coincide con la curva cubic-bezier y empieza en 0 y acaba en 1', (name, curve) => {
    const fn = easingFn(name as keyof typeof EASING_CURVES);
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
    for (let x = 0.01; x < 1; x += 0.049) expect(fn(x)).toBeCloseTo(reference(curve, x), 4);
  });

  it('valores conocidos de CSS', () => {
    expect(easingFn('easeIn')(0.5)).toBeCloseTo(0.3153, 3);
    expect(easingFn('easeOut')(0.5)).toBeCloseTo(0.6847, 3);
    expect(easingFn('easeInOut')(0.5)).toBeCloseTo(0.5, 6);
    // cubic-bezier(0.25, 0.1, 0.25, 1) es `ease`.
    expect(easingFn([0.25, 0.1, 0.25, 1])(0.5)).toBeCloseTo(0.8024, 3);
  });

  it('easeOutBack se pasa de 1 antes de volver', () => {
    const fn = easingFn('easeOutBack');
    let max = 0;
    for (let x = 0; x <= 1; x += 0.01) max = Math.max(max, fn(x));
    expect(max).toBeGreaterThan(1.05);
  });

  it('una curva personalizada casi plana (Newton no sirve) también converge', () => {
    const curve = [0.9, 0, 0.1, 1] as const;
    const fn = cubicBezier(...curve);
    for (let x = 0.01; x < 1; x += 0.037) expect(fn(x)).toBeCloseTo(reference(curve, x), 3);
  });
});

describe('OKLab', () => {
  it('ida y vuelta sin pérdida y el alfa se interpola en lineal', () => {
    for (const hex of ['#000000FF', '#FFFFFFFF', '#FB8F5A80', '#3D7BFF00']) expect(oklabToHex(hexToOklab(hex))).toBe(hex);
    const mid = mixOklab(hexToOklab('#000000FF'), hexToOklab('#FFFFFF00'), 0.5);
    expect(mid[0]).toBeCloseTo(0.5, 4);
    expect(oklabToHex(mid).slice(7)).toBe('80');
  });

  it('el punto medio entre negro y blanco es el gris perceptual, no el de sRGB', () => {
    const hex = oklabToHex(mixOklab(hexToOklab('#000000FF'), hexToOklab('#FFFFFFFF'), 0.5));
    expect(hex).toBe('#636363FF');
  });
});

describe('interpolación de pistas', () => {
  const compiled = compileAnimation(
    animation({
      offsetX: { c: { t: 1, v: 300, e: 'linear' }, a: { t: 0, v: 0, e: 'linear' }, b: { t: 0.5, v: 100, e: 'step' } },
      fill: { a: { t: 0, v: '#000000FF', e: 'linear' }, b: { t: 1, v: '#FFFFFFFF', e: 'linear' } },
    }),
  );
  const track = (prop: string) => compiled.tracks.find(([name]) => name === prop)![1] as CompiledTrack;

  it('ordena los keyframes por t y busca el tramo', () => {
    const x = track('offsetX') as Extract<CompiledTrack, { color: false }>;
    expect([...x.times]).toEqual([0, 0.5, 1]);
    expect(sampleNumber(x, 0)).toBe(0);
    expect(sampleNumber(x, 0.25)).toBe(50);
    // step mantiene el valor del keyframe hasta el siguiente.
    expect(sampleNumber(x, 0.75)).toBe(100);
    expect(sampleNumber(x, 1)).toBe(300);
  });

  it('fuera de los keyframes se queda en el extremo', () => {
    const only = compileAnimation(animation({ scale: { a: { t: 0.2, v: 2, e: 'linear' }, b: { t: 0.8, v: 4, e: 'linear' } } }));
    const scale = only.tracks[0]![1] as Extract<CompiledTrack, { color: false }>;
    expect(sampleNumber(scale, 0)).toBe(2);
    expect(sampleNumber(scale, 0.5)).toBeCloseTo(3, 9);
    expect(sampleNumber(scale, 1)).toBe(4);
  });

  it('interpola los colores en OKLab', () => {
    expect(sampleColor(track('fill') as Extract<CompiledTrack, { color: true }>, 0.5)).toBe('#636363FF');
  });

  it('los valores relativos y absolutos llegan a la pose', () => {
    const pose = poseAt(
      compileAnimation(
        animation({
          offsetY: { a: { t: 0, v: 0, e: 'linear' }, b: { t: 1, v: -20, e: 'linear' } },
          rotation: { a: { t: 0, v: 0, e: 'linear' }, b: { t: 1, v: 1, e: 'linear' } },
          opacity: { a: { t: 0, v: 1, e: 'easeOutBack' }, b: { t: 1, v: 0, e: 'linear' } },
        }),
      ),
      500,
    );
    expect(pose.dy).toBe(-10);
    expect(pose.rotation).toBe(0.5);
    expect(pose.scale).toBe(1);
    expect(pose.dx).toBe(0);
    // Un easing que se pasa de rango no deja la opacidad fuera de 0..1.
    expect(pose.opacity).toBeGreaterThanOrEqual(0);
    expect(pose.opacity).toBeLessThanOrEqual(1);
    expect(pose.fill).toBeUndefined();
  });
});

describe('delay, repeticiones y dirección', () => {
  it('la duración efectiva incluye delay y repeticiones', () => {
    expect(effectiveDuration({ duration: 1000, delay: 250, loop: 3 })).toBe(3250);
    expect(effectiveDuration({ duration: 1000, delay: 0, loop: 0 })).toBe(Infinity);
  });

  it('el avance llega al 100 % al final de la duración efectiva', () => {
    const settings = { duration: 1000, delay: 250, loop: 3, direction: 'normal' as const };
    expect(progressAt(settings, 0)).toBe(0);
    expect(progressAt(settings, 250)).toBe(0);
    expect(progressAt(settings, 750)).toBe(0.5);
    expect(progressAt(settings, 1750)).toBe(0.5);
    expect(progressAt(settings, 3249)).toBeCloseTo(0.999, 6);
    expect(progressAt(settings, 3250)).toBe(1);
    expect(progressAt(settings, 99_999)).toBe(1);
  });

  it('alternate va y vuelve; con un número par de vueltas acaba en el inicio', () => {
    const settings = { duration: 1000, delay: 0, loop: 2, direction: 'alternate' as const };
    expect(progressAt(settings, 250)).toBe(0.25);
    expect(progressAt(settings, 1250)).toBe(0.75);
    expect(progressAt(settings, 2000)).toBe(0);
    expect(progressAt({ ...settings, loop: 3 }, 3000)).toBe(1);
  });
});

describe('AnimationPlayer en el motor', () => {
  function setup(settings: Partial<Omit<Animation, 'tracks'>> = {}) {
    const harness = makeCore();
    const id = putNode(harness.doc, rect({ x: 10, y: 20 }));
    harness.tick(0);
    const keyframes = new AnimationCommands(harness.core);
    expect(keyframes.setAnimation(id, { duration: 1000, delay: 200, loop: 2, ...settings })).toBe(true);
    keyframes.addKeyframe(id, 'offsetX', { t: 0, v: 0 });
    keyframes.addKeyframe(id, 'offsetX', { t: 1, v: 100 });
    keyframes.addKeyframe(id, 'fill', { t: 0, v: '#000000FF' });
    keyframes.addKeyframe(id, 'fill', { t: 1, v: '#FFFFFFFF' });
    harness.tick(0);
    return { ...harness, id, keyframes };
  }

  it('reproduce hasta el 100 % con delay y repeticiones y después devuelve la vista al documento', () => {
    const { core, sink, tick, id } = setup();
    const states: number[] = [];
    core.anim.state.subscribe((state) => states.push(state.time));
    core.anim.play();
    expect(core.anim.state.get()).toMatchObject({ status: 'playing', duration: 2200 });
    for (let t = 1000; t <= 3200; t += 100) tick(t);
    // El último frame reproducido muestra el final de la segunda vuelta.
    expect(Math.max(...states)).toBe(2200);
    const final = sink.overrides.get(id);
    expect(final?.gesture?.matrix[4]).toBeCloseTo(100, 6);
    expect((final?.record as { fill?: string }).fill).toBe('#FFFFFFFF');
    tick(3300);
    expect(core.anim.state.get()).toMatchObject({ status: 'paused', time: 2200 });
    expect(sink.overrides.has(id)).toBe(false);
    // El documento no cambió.
    expect(core.record(id)).toMatchObject({ x: 10, y: 20, fill: '#FF0000FF' });
  });

  it('a mitad de la primera vuelta la vista está a mitad de camino', () => {
    const { core, sink, tick, id } = setup();
    core.anim.play();
    tick(0);
    tick(700);
    const pose = sink.overrides.get(id)!;
    expect(pose.gesture?.matrix[4]).toBeCloseTo(50, 6);
    expect((pose.record as { fill?: string }).fill).toBe('#636363FF');
    expect(pose.redraw).toBe(true);
  });

  it('bloquea la edición de los nodos animados mientras se reproduce y la libera al pausar', () => {
    const { core, sink, tick, id } = setup();
    core.anim.play();
    tick(0);
    expect(core.isLocked(id)).toBe(true);
    core.setSelection([id]);
    core.commands.nudge(5, 0);
    tick(100);
    expect(core.record(id)?.x).toBe(10);
    core.anim.pause();
    tick(200);
    expect(core.isLocked(id)).toBe(false);
    expect(sink.overrides.has(id)).toBe(false);
    core.commands.nudge(5, 0);
    tick(300);
    expect(core.record(id)?.x).toBe(15);
  });

  it('seek en pausa muestra la pose de ese instante', () => {
    const { core, sink, tick, id } = setup({ delay: 0, loop: 1 });
    core.anim.seek(250);
    tick(0);
    expect(sink.overrides.get(id)?.gesture?.matrix[4]).toBeCloseTo(25, 6);
    core.anim.stop();
    tick(10);
    expect(sink.overrides.has(id)).toBe(false);
    expect(core.anim.state.get()).toMatchObject({ status: 'stopped', time: 0 });
  });

  it('la escala es relativa al centro del nodo', () => {
    const { core, sink, tick, id, keyframes } = setup({ delay: 0, loop: 1 });
    keyframes.addKeyframe(id, 'scale', { t: 0, v: 2 });
    tick(0);
    core.anim.seek(0);
    tick(1);
    const m = sink.overrides.get(id)!.gesture!.matrix;
    // El centro (10 + 50, 20 + 25) no se mueve.
    expect(m[0] * 60 + m[2] * 45 + m[4]).toBeCloseTo(60, 6);
    expect(m[1] * 60 + m[3] * 45 + m[5]).toBeCloseTo(45, 6);
    expect(m[0]).toBeCloseTo(2, 6);
  });
});

describe('escalas por eje, color de texto y vista previa', () => {
  function animate(seed: (keyframes: AnimationCommands, ids: string[]) => void, nodes: Array<Record<string, unknown>> = [rect({ x: 10, y: 20 })]) {
    const harness = makeCore();
    const ids = nodes.map((node) => putNode(harness.doc, node));
    harness.tick(0);
    const keyframes = new AnimationCommands(harness.core);
    seed(keyframes, ids);
    harness.tick(0);
    return { ...harness, ids, keyframes };
  }

  it('scaleX y scaleY escalan cada eje alrededor del centro y una escala negativa no voltea', () => {
    const { core, sink, tick, ids } = animate((keyframes, [id]) => {
      keyframes.addKeyframe(id!, 'scaleX', { t: 0, v: 2 });
      keyframes.addKeyframe(id!, 'scaleY', { t: 0, v: 0.5 });
      keyframes.addKeyframe(id!, 'scale', { t: 1, v: 1 });
    });
    const id = ids[0]!;
    core.anim.seek(0);
    tick(1);
    const m = sink.overrides.get(id)!.gesture!.matrix;
    expect(m[0]).toBeCloseTo(2, 6);
    expect(m[3]).toBeCloseTo(0.5, 6);
    expect(m[0] * 60 + m[2] * 45 + m[4]).toBeCloseTo(60, 6);
    expect(m[1] * 60 + m[3] * 45 + m[5]).toBeCloseTo(45, 6);
    expect(core.anim.poseAt(id, 0)).toMatchObject({ sx: 2, sy: 0.5, scale: 1 });
    // Una pista con un valor negativo escrito a mano (sin pasar por los comandos) se pinta con escala 0.
    core.writer.transact({}, (w) => w.setKeyframe(id, 'scale', 'neg', { t: 0, v: -1, e: 'linear' }));
    tick(2);
    core.anim.seek(0);
    tick(3);
    expect(sink.overrides.get(id)!.gesture!.matrix[0]).toBeCloseTo(0, 6);
  });

  it('la pista fill de un texto pinta el color de la letra', () => {
    const textNode = {
      ...rect({ x: 0, y: 0, w: 100, h: 30 }),
      type: 'text',
      fontFamily: 'Manrope',
      fontSize: 24,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: '#EEF2F6FF',
      align: 'left',
      lineHeight: 1.25,
      autoWidth: false,
    } as Record<string, unknown>;
    for (const key of ['fill', 'stroke', 'strokeWidth', 'strokeDash', 'shadow', 'cornerRadius']) delete textNode[key];
    const { core, sink, tick, ids } = animate(
      (keyframes, [id]) => {
        keyframes.addKeyframe(id!, 'fill', { t: 0, v: '#000000FF' });
        keyframes.addKeyframe(id!, 'fill', { t: 1, v: '#FFFFFFFF' });
      },
      [textNode],
    );
    core.anim.seek(500);
    tick(1);
    const view = sink.overrides.get(ids[0]!)!;
    expect((view.record as { color?: string }).color).toBe('#636363FF');
    expect(view.redraw).toBe(true);
    expect(core.record(ids[0]!)).toMatchObject({ color: '#EEF2F6FF' });
  });

  it('la vista previa reproduce solo los nodos pedidos y al terminar vuelve al estado base', () => {
    const { core, sink, tick, ids } = animate(
      (keyframes, [a, b]) => {
        for (const id of [a!, b!]) {
          keyframes.addKeyframe(id, 'offsetX', { t: 0, v: 0 });
          keyframes.addKeyframe(id, 'offsetX', { t: 1, v: 100 });
        }
      },
      [rect({ x: 0 }), rect({ x: 300 })],
    );
    const [a, b] = ids as [string, string];
    core.anim.setRepeat(true);
    expect(core.anim.preview([a])).toBe(true);
    expect(core.anim.state.get()).toMatchObject({ status: 'playing', preview: true, duration: 1000 });
    tick(1000);
    tick(1500);
    expect(sink.overrides.get(a)?.gesture?.matrix[4]).toBeCloseTo(50, 6);
    expect(sink.overrides.has(b)).toBe(false);
    // Sin repetir aunque la repetición esté activa: el frame del final y el siguiente lo paran.
    tick(2100);
    tick(2200);
    expect(core.anim.state.get()).toMatchObject({ status: 'stopped', time: 0, preview: false });
    expect(sink.overrides.size).toBe(0);
    expect(core.isLocked(a)).toBe(false);
    // Lo que no tiene animación no reproduce nada.
    expect(core.anim.preview(['nada'])).toBe(false);
    expect(core.anim.state.get().status).toBe('stopped');
  });

  it('la vista previa publica sus nodos, y una sin nada que reproducir no para la reproducción normal', () => {
    const { core, tick, ids } = animate((keyframes, [id]) => {
      keyframes.addKeyframe(id!, 'offsetX', { t: 0, v: 0 });
      keyframes.addKeyframe(id!, 'offsetX', { t: 1, v: 100 });
    });
    const id = ids[0]!;
    core.anim.preview([id]);
    expect(core.anim.state.get()).toMatchObject({ preview: true, previewIds: [id] });
    core.anim.preview(null);
    expect(core.anim.state.get()).toMatchObject({ status: 'stopped', preview: false, previewIds: null });
    core.anim.play();
    tick(0);
    tick(300);
    expect(core.anim.preview(['nada'])).toBe(false);
    expect(core.anim.state.get()).toMatchObject({ status: 'playing', preview: false, previewIds: null });
    tick(400);
    expect(core.anim.state.get().time).toBeGreaterThan(0);
  });

  it('Esc y preview(null) detienen la vista previa', () => {
    const { core, sink, tick, ids } = animate((keyframes, [id]) => {
      keyframes.addKeyframe(id!, 'offsetX', { t: 0, v: 0 });
      keyframes.addKeyframe(id!, 'offsetX', { t: 1, v: 100 });
    });
    const id = ids[0]!;
    core.anim.preview([id]);
    tick(0);
    tick(300);
    expect(sink.overrides.has(id)).toBe(true);
    expect(core.controller.keyDown({ key: 'Escape', code: 'Escape', ctrl: false, shift: false, alt: false, repeat: false })).toBe(true);
    tick(400);
    expect(core.anim.state.get()).toMatchObject({ status: 'stopped', preview: false });
    expect(sink.overrides.has(id)).toBe(false);
    core.anim.preview([id]);
    tick(500);
    core.anim.preview(null);
    tick(600);
    expect(core.anim.state.get()).toMatchObject({ status: 'stopped', preview: false });
    expect(sink.overrides.size).toBe(0);
  });
});
