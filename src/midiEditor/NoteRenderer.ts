import * as PIXI from 'src/controls/pixi';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import ShaderMesh, { f, hexToVec3 } from 'src/midiEditor/ShaderMesh';
import * as conf from './conf';

const FLOATS_PER_INSTANCE = 5;
const NOTE_BORDER_COLOR = 0x333333;

const VERTEX_SRC = `
attribute vec2 aPos;
attribute float aStartBeat;
attribute float aLengthBeats;
attribute float aLineIx;
attribute float aVelocity;
attribute float aFlags;

uniform vec2 uViewport;
uniform float uScrollBeats;
uniform float uPxPerBeat;
uniform float uScrollVerticalPx;

varying vec2 vLocalPx;
varying float vWidthPx;
varying float vVelocity;
varying float vFlags;

void main() {
  float widthPx = max(aLengthBeats * uPxPerBeat - 1., 0.);
  float x0 = ${f(conf.PIANO_KEYBOARD_WIDTH)} + (aStartBeat - uScrollBeats) * uPxPerBeat;
  float y0 = ${f(conf.CURSOR_GUTTER_HEIGHT)} + aLineIx * ${f(conf.LINE_HEIGHT)} - uScrollVerticalPx;

  vLocalPx = aPos * vec2(widthPx, ${f(conf.LINE_HEIGHT)});
  vWidthPx = widthPx;
  vVelocity = aVelocity;
  vFlags = aFlags;

  vec2 px = vec2(x0, y0) + vLocalPx;
  gl_Position = vec4(px.x / uViewport.x * 2. - 1., 1. - px.y / uViewport.y * 2., 0., 1.);
}`;

const FRAGMENT_SRC = `
precision highp float;

varying vec2 vLocalPx;
varying float vWidthPx;
varying float vVelocity;
varying float vFlags;

uniform float uVelocityEnabled;

void main() {
  vec2 p = vLocalPx;
  float w = vWidthPx;
  vec3 color = vFlags > 0.5 ? ${hexToVec3(conf.NOTE_SELECTED_COLOR)} : ${hexToVec3(conf.NOTE_COLOR)};

  if (p.x < 1. || p.x > w - 1. || p.y < 1. || p.y > ${f(conf.LINE_HEIGHT - 1)}) {
    color = ${hexToVec3(NOTE_BORDER_COLOR)};
  }

  if (uVelocityEnabled > 0.5 && p.y > ${f(conf.LINE_HEIGHT - 5.5)}) {
    float barW = floor((w - 1.) * vVelocity);
    if (p.x >= 1. && p.x < 1. + barW) {
      color = ${hexToVec3(conf.NOTE_VELOCITY_BAR_COLOR)};
    } else if (p.x >= 1. + barW && p.x < 6. + barW) {
      color = ${hexToVec3(conf.NOTE_VELOCITY_HANDLE_COLOR)};
    }
  }

  float noteW = w + 1.;
  float handleW = noteW >= 20. ? 8. : max(floor((noteW - 6.) / 2.), 3.);
  if (p.y >= 1. && p.y <= ${f(conf.LINE_HEIGHT - 1)} && (p.x <= handleW || p.x >= w - handleW)) {
    color = mix(color, ${hexToVec3(conf.NOTE_DRAG_HANDLE_COLOR)}, 0.2);
  }

  gl_FragColor = vec4(color, 1.);
}`;

export default class NoteRenderer extends ShaderMesh {
  private app: MIDIEditorUIInstance;
  private instanceData = new Float32Array(64 * FLOATS_PER_INSTANCE);
  private instanceBuffer: PIXI.Buffer;

  constructor(app: MIDIEditorUIInstance) {
    const instanceBuffer = new PIXI.Buffer(
      new Float32Array(64 * FLOATS_PER_INSTANCE) as unknown as PIXI.ITypedArray,
      false
    );
    const strideBytes = FLOATS_PER_INSTANCE * 4;
    const geometry = new PIXI.Geometry()
      .addAttribute('aPos', [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3])
      .addAttribute('aStartBeat', instanceBuffer, 1, false, PIXI.TYPES.FLOAT, strideBytes, 0, true)
      .addAttribute(
        'aLengthBeats',
        instanceBuffer,
        1,
        false,
        PIXI.TYPES.FLOAT,
        strideBytes,
        4,
        true
      )
      .addAttribute('aLineIx', instanceBuffer, 1, false, PIXI.TYPES.FLOAT, strideBytes, 8, true)
      .addAttribute('aVelocity', instanceBuffer, 1, false, PIXI.TYPES.FLOAT, strideBytes, 12, true)
      .addAttribute('aFlags', instanceBuffer, 1, false, PIXI.TYPES.FLOAT, strideBytes, 16, true);
    geometry.instanced = true;
    geometry.instanceCount = 0;

    const shader = PIXI.Shader.from(VERTEX_SRC, FRAGMENT_SRC, {
      uViewport: new Float32Array(2),
      uScrollBeats: 0,
      uPxPerBeat: 1,
      uScrollVerticalPx: 0,
      uVelocityEnabled: 0,
    });
    super(geometry, shader, 6);
    this.app = app;
    this.instanceBuffer = instanceBuffer;
    this.handleResize();
  }

  public handleResize() {
    this.shader.uniforms.uViewport = new Float32Array([this.app.width, this.app.height]);
  }

  public handleViewChange() {
    const baseView = this.app.parentInstance.baseView;
    const u = this.shader.uniforms;
    u.uScrollBeats = baseView.scrollHorizontalBeats;
    u.uPxPerBeat = baseView.pxPerBeat;
    u.uScrollVerticalPx = this.app.view.scrollVerticalPx;
  }

  public setVelocityDisplayEnabled(enabled: boolean) {
    this.shader.uniforms.uVelocityEnabled = enabled ? 1 : 0;
  }

  /**
   * Rewrites the full instance buffer from the note store.  Called whenever note data or
   * selection changes; full reupload is well under a millisecond at realistic note counts.
   */
  public sync() {
    const notes = this.app.notes;
    const noteCount = notes.noteCount;
    if (noteCount * FLOATS_PER_INSTANCE > this.instanceData.length) {
      let newLen = this.instanceData.length * 2;
      while (noteCount * FLOATS_PER_INSTANCE > newLen) {
        newLen *= 2;
      }
      this.instanceData = new Float32Array(newLen);
    }

    const buf = this.instanceData;
    let i = 0;
    for (let lineIx = 0; lineIx < notes.lineCount; lineIx++) {
      for (const note of notes.getLine(lineIx)) {
        buf[i] = note.startPoint;
        buf[i + 1] = note.length;
        buf[i + 2] = lineIx;
        buf[i + 3] = note.velocity / 127;
        buf[i + 4] = this.app.selectedNoteIDs.has(note.id) ? 1 : 0;
        i += FLOATS_PER_INSTANCE;
      }
    }

    this.geometry.instanceCount = noteCount;
    this.instanceBuffer.update(buf.subarray(0, i) as unknown as PIXI.ITypedArray);
  }
}
