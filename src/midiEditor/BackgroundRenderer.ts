import * as PIXI from 'src/controls/pixi';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import ShaderMesh, { f, hexToVec3 } from 'src/midiEditor/ShaderMesh';
import { clamp } from 'src/util';
import * as conf from './conf';

const MAX_TICK_LEVELS = 8;
const TICK_FADE_START_PX = 6;
const TICK_FADE_END_PX = 14;

const VERTEX_SRC = `
attribute vec2 aPos;

uniform vec4 uBounds;
uniform vec2 uViewport;

varying vec2 vPx;

void main() {
  vPx = mix(uBounds.xy, uBounds.zw, aPos);
  gl_Position = vec4(vPx.x / uViewport.x * 2. - 1., 1. - vPx.y / uViewport.y * 2., 0., 1.);
}`;

const FRAGMENT_SRC = `
precision highp float;

varying vec2 vPx;

uniform float uScrollBeats;
uniform float uPxPerBeat;
uniform float uScrollVerticalPx;
uniform float uLineCount;
uniform float uDpr;
// (intervalBeats, alpha, isFullHeight) per level, ordered fine -> coarse
uniform vec3 uTickLevels[${MAX_TICK_LEVELS}];
uniform int uTickLevelCount;

void main() {
  float beat = uScrollBeats + (vPx.x - ${f(conf.PIANO_KEYBOARD_WIDTH)}) / uPxPerBeat;
  float yGrid = vPx.y - ${f(conf.CURSOR_GUTTER_HEIGHT)} + uScrollVerticalPx;
  float lineIx = floor(yGrid / ${f(conf.LINE_HEIGHT)});
  float inLineY = yGrid - lineIx * ${f(conf.LINE_HEIGHT)};

  if (lineIx < 0. || lineIx >= uLineCount) {
    gl_FragColor = vec4(${hexToVec3(conf.BACKGROUND_COLOR)}, 1.);
    return;
  }

  float noteInOctave = mod(uLineCount - lineIx, 12.);
  bool isAccidental = abs(noteInOctave - 1.) < .5 || abs(noteInOctave - 3.) < .5 ||
    abs(noteInOctave - 6.) < .5 || abs(noteInOctave - 8.) < .5 || abs(noteInOctave - 10.) < .5;
  vec3 color = isAccidental
    ? ${hexToVec3(conf.BLACK_NOTE_LINE_COLOR)}
    : ${hexToVec3(conf.WHITE_NOTE_LINE_COLOR)};

  if (inLineY >= ${f(conf.LINE_HEIGHT - 1)}) {
    color = ${hexToVec3(conf.LINE_BORDER_COLOR)};
  }

  float aa = 0.5 / uDpr;
  for (int i = 0; i < ${MAX_TICK_LEVELS}; i++) {
    if (i >= uTickLevelCount) {
      break;
    }
    float interval = uTickLevels[i].x;
    float p = mod(beat, interval);
    float distPx = min(p, interval - p) * uPxPerBeat;
    float a = clamp((0.5 + aa - distPx) / (2. * aa), 0., 1.) * uTickLevels[i].y;
    bool fullHeight = uTickLevels[i].z > 0.5;
    if (!fullHeight && inLineY < ${f(conf.LINE_HEIGHT * 0.82)}) {
      a = 0.;
    }
    color = mix(
      color,
      fullHeight ? ${hexToVec3(conf.MEASURE_LINE_COLOR)} : ${hexToVec3(conf.NOTE_MARK_TICK_COLOR)},
      a
    );
  }

  gl_FragColor = vec4(color, 1.);
}`;

const tickLevelAlpha = (intervalBeats: number, pxPerBeat: number): number =>
  clamp(
    0,
    1,
    (intervalBeats * pxPerBeat - TICK_FADE_START_PX) / (TICK_FADE_END_PX - TICK_FADE_START_PX)
  );

/**
 * Builds the visible tick level ladder, ordered fine -> coarse: sub-beat subdivisions down to the
 * beat snap interval, the beat, then measure multiples coarsening as needed when zoomed far out.
 */
const computeTickLevels = (
  pxPerBeat: number,
  beatsPerMeasure: number,
  beatSnapInterval: number
): { interval: number; alpha: number; fullHeight: boolean }[] => {
  const levels: { interval: number; alpha: number; fullHeight: boolean }[] = [];

  const subBeatIntervals: number[] = [];
  if (beatSnapInterval === 1 / 3 || beatSnapInterval === 1 / 6) {
    subBeatIntervals.push(1 / 3);
    if (beatSnapInterval < 1 / 3) {
      subBeatIntervals.push(1 / 6);
    }
  } else {
    const finest = beatSnapInterval === 0 ? 1 / 16 : Math.max(beatSnapInterval, 1 / 16);
    for (let interval = 1 / 2; interval >= finest * 0.999; interval /= 2) {
      subBeatIntervals.push(interval);
    }
  }
  subBeatIntervals.reverse();

  for (const interval of subBeatIntervals) {
    const alpha = tickLevelAlpha(interval, pxPerBeat);
    if (alpha > 0) {
      levels.push({ interval, alpha, fullHeight: false });
    }
  }

  if (beatsPerMeasure > 1) {
    const alpha = tickLevelAlpha(1, pxPerBeat);
    if (alpha > 0) {
      levels.push({ interval: 1, alpha, fullHeight: false });
    }
  }

  for (let k = 0; k < 24; k++) {
    const interval = beatsPerMeasure * Math.pow(2, k);
    const alpha = tickLevelAlpha(interval, pxPerBeat);
    if (alpha > 0) {
      levels.push({ interval, alpha, fullHeight: true });
    }
    if (alpha >= 1) {
      break;
    }
  }

  return levels.slice(-MAX_TICK_LEVELS);
};

export default class BackgroundRenderer extends ShaderMesh {
  private app: MIDIEditorUIInstance;
  private tickLevelsBuf = new Float32Array(MAX_TICK_LEVELS * 3);

  constructor(app: MIDIEditorUIInstance) {
    const geometry = new PIXI.Geometry()
      .addAttribute('aPos', [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    const shader = PIXI.Shader.from(VERTEX_SRC, FRAGMENT_SRC, {
      uBounds: new Float32Array(4),
      uViewport: new Float32Array(2),
      uScrollBeats: 0,
      uPxPerBeat: 1,
      uScrollVerticalPx: 0,
      uLineCount: 0,
      uDpr: window.devicePixelRatio ?? 1,
      uTickLevels: new Float32Array(MAX_TICK_LEVELS * 3),
      uTickLevelCount: 0,
    });
    super(geometry, shader, 6);
    this.app = app;
    this.handleResize();
  }

  public handleResize() {
    const u = this.shader.uniforms;
    u.uBounds = new Float32Array([
      conf.PIANO_KEYBOARD_WIDTH,
      conf.CURSOR_GUTTER_HEIGHT,
      this.app.width,
      this.app.height,
    ]);
    u.uViewport = new Float32Array([this.app.width, this.app.height]);
  }

  public handleViewChange() {
    const baseView = this.app.parentInstance.baseView;
    const u = this.shader.uniforms;
    u.uScrollBeats = baseView.scrollHorizontalBeats;
    u.uPxPerBeat = baseView.pxPerBeat;
    u.uScrollVerticalPx = this.app.view.scrollVerticalPx;
    u.uLineCount = this.app.notes.lineCount;

    const levels = computeTickLevels(
      baseView.pxPerBeat,
      baseView.beatsPerMeasure,
      this.app.parentInstance.beatSnapInterval
    );
    this.tickLevelsBuf.fill(0);
    levels.forEach((level, i) => {
      this.tickLevelsBuf[i * 3] = level.interval;
      this.tickLevelsBuf[i * 3 + 1] = level.alpha;
      this.tickLevelsBuf[i * 3 + 2] = level.fullHeight ? 1 : 0;
    });
    u.uTickLevels = this.tickLevelsBuf;
    u.uTickLevelCount = levels.length;
  }
}
