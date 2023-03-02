import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import { makeDraggable } from 'src/controls/pixiUtils';
import { getSentry } from 'src/sentry';

type BuildWavetableWasmEngine = typeof import('src/wavegen');

const dpr = window.devicePixelRatio ?? 1;

const BACKGROUND_COLOR = 0x020202;
export const BUILD_WAVETABLE_INST_HEIGHT_PX = 450;
export const BUILD_WAVETABLE_INST_WIDTH_PX = Math.round(BUILD_WAVETABLE_INST_HEIGHT_PX * 1.618);

const HARMONICS_COUNT = 64;

const SLIDER_BG_COLOR = 0x1f1f1f;
const SLIDER_BORDER_COLOR = 0x2f2f2f;
const SLIDER_WIDTH = 19;
const SLIDER_HEIGHT = 160;
const SLIDER_LABEL_COLOR = 0x727272;
const SLIDER_LABEL_FONT_FAMILY = 'Hack';
const SLIDER_LABEL_FONT_SIZE = 9.5;
const SLIDER_HANDLE_COLOR = 0x4a4a4a;
const SLIDER_HANDLE_HEIGHT = 10;

const WAVEFORM_IMAGE_HEIGHT_PX = 256;
const WAVEFORM_IMAGE_WIDTH_PX = 1024;

export enum SliderMode {
  Magnitude,
  Phase,
}

export interface BuildWavetableInstanceState {
  harmonics: { magnitude: number; phase: number }[];
  sliderMode: SliderMode;
}

const buildDefaultBuildWavetableInstanceState = (): BuildWavetableInstanceState => ({
  harmonics: new Array(HARMONICS_COUNT)
    .fill(null)
    .map((_, i) => ({ magnitude: i === 1 ? 1 : 0, phase: 0 })),
  sliderMode: SliderMode.Magnitude,
});

/**
 * Expects values to be in the range [0, 1].
 */
class VerticalSlider {
  private bg: PIXI.Graphics;
  private handle: PIXI.Graphics;
  private onChange: (value: number) => void;
  private value: number;
  public dragData: PIXI.InteractionData | null = null;

  public get graphics() {
    return this.bg;
  }

  constructor(onChange: (value: number) => void, initialValue: number, ix: number) {
    this.onChange = onChange;
    this.value = initialValue;

    this.bg = new PIXI.Graphics()
      .beginFill(SLIDER_BG_COLOR)
      .drawRect(0, 0, SLIDER_WIDTH, SLIDER_HEIGHT)
      .endFill()
      .lineStyle(1, SLIDER_BORDER_COLOR)
      .drawRect(0, 0, SLIDER_WIDTH, SLIDER_HEIGHT);
    this.bg.interactive = true;
    // this.bg.cacheAsBitmap = true;
    this.bg.on('pointerdown', this.onPointerDown);
    makeDraggable(this.bg, this);

    const label = new PIXI.Text(`${ix}`, {
      fontFamily: SLIDER_LABEL_FONT_FAMILY,
      fontSize: SLIDER_LABEL_FONT_SIZE,
      fill: SLIDER_LABEL_COLOR,
    });
    label.x = SLIDER_WIDTH / 2 - label.width / 2;
    label.y = SLIDER_HEIGHT - label.height - 12;
    this.bg.addChild(label);

    this.handle = new PIXI.Graphics()
      .beginFill(SLIDER_HANDLE_COLOR)
      .drawRect(0, 0, SLIDER_WIDTH, SLIDER_HANDLE_HEIGHT);
    this.handle.interactive = true;
    // this.handle.cacheAsBitmap = true;
    this.handle.on('pointerdown', this.onPointerDown);
    makeDraggable(this.handle, this);
    this.bg.addChild(this.handle);
    this.handle.y = (1 - initialValue) * (SLIDER_HEIGHT - SLIDER_HANDLE_HEIGHT);
  }

  private handleChange = (localY: number) => {
    const y = R.clamp(0, SLIDER_HEIGHT - SLIDER_HANDLE_HEIGHT, localY);
    this.value = 1 - y / (SLIDER_HEIGHT - SLIDER_HANDLE_HEIGHT);
    this.handle.y = y;
    this.onChange(this.value);
  };

  private onPointerDown = (event: PIXI.InteractionEvent) => {
    const localPos = event.data.getLocalPosition(this.bg);
    this.handleChange(localPos.y);
    this.dragData = event.data;
  };

  public handleDrag = (newPos: PIXI.Point) => {
    this.handleChange(newPos.y - SLIDER_HANDLE_HEIGHT);
  };

  public setValue(newValue: number) {
    this.value = newValue;
    this.handle.y = this.value * (SLIDER_HEIGHT - SLIDER_HANDLE_HEIGHT);
  }
}

export class BuildWavetableInstance {
  private app: PIXI.Application;
  private engine: BuildWavetableWasmEngine | null = null;
  private getWasmMemory: () => Uint8Array = () => new Uint8Array(0);
  private slidersContainer: PIXI.Container;
  private state: BuildWavetableInstanceState = buildDefaultBuildWavetableInstanceState();
  private waveformImage: PIXI.Sprite;
  private waveformContainer: PIXI.Container;

  constructor(canvas: HTMLCanvasElement) {
    Promise.all([import('src/wavegen'), import('src/wavegen_bg.wasm')] as const).then(
      ([wavegenMod, wasm]) => {
        this.getWasmMemory = () => new Uint8Array(wasm.memory.buffer);
        this.engine = wavegenMod;
        this.commit();
      }
    );

    try {
      this.app = new PIXI.Application({
        antialias: true,
        autoDensity: true,
        view: canvas,
        height: BUILD_WAVETABLE_INST_HEIGHT_PX * dpr,
        width: BUILD_WAVETABLE_INST_WIDTH_PX * dpr,
        backgroundColor: BACKGROUND_COLOR,
      });
    } catch (err) {
      console.error('Failed to initialize PixiJS applicationl; WebGL not supported?');
      getSentry()?.captureException(err);
      throw err;
    }

    this.slidersContainer = new PIXI.Container();
    for (let harmonicIx = 0; harmonicIx < HARMONICS_COUNT; harmonicIx++) {
      if (harmonicIx === 0) {
        continue;
      }

      const slider = new VerticalSlider(
        newValue => this.handleSliderChange(harmonicIx, newValue),
        this.state.harmonics[harmonicIx].magnitude,
        harmonicIx
      );
      slider.graphics.x = harmonicIx * SLIDER_WIDTH;
      slider.graphics.y = 10;
      this.slidersContainer.addChild(slider.graphics);
    }
    this.slidersContainer.y = BUILD_WAVETABLE_INST_HEIGHT_PX - SLIDER_HEIGHT - 10;
    this.app.stage.addChild(this.slidersContainer);

    this.waveformContainer = new PIXI.Container();
    this.waveformContainer.x = 10;
    this.waveformContainer.y = 10;
    this.app.stage.addChild(this.waveformContainer);

    this.waveformImage = new PIXI.Sprite();
    this.waveformContainer.addChild(this.waveformImage);
  }

  public setSliderMode = (sliderMode: SliderMode) => {
    this.state.sliderMode = sliderMode;
    for (let harmonicIx = 0; harmonicIx < HARMONICS_COUNT; harmonicIx++) {
      if (harmonicIx === 0) {
        continue;
      }

      const slider = this.slidersContainer.getChildAt(harmonicIx - 1) as unknown as VerticalSlider;
      if (sliderMode === SliderMode.Magnitude) {
        slider.setValue(this.state.harmonics[harmonicIx].magnitude);
      } else {
        slider.setValue(this.state.harmonics[harmonicIx].phase);
      }
    }
  };

  private handleSliderChange = (sliderIx: number, value: number) => {
    if (this.state.sliderMode === SliderMode.Magnitude) {
      this.setHarmonicMagnitude(sliderIx, value);
    } else {
      this.setHarmonicPhase(sliderIx, value);
    }
  };

  private setHarmonicMagnitude = (harmonicIx: number, value: number) => {
    const oldMagnitude = this.state.harmonics[harmonicIx].magnitude;
    if (oldMagnitude === value) {
      return;
    }

    this.state.harmonics[harmonicIx].magnitude = value;
    this.commit();
  };

  private setHarmonicPhase = (harmonicIx: number, value: number) => {
    const oldPhase = this.state.harmonics[harmonicIx].phase;
    if (oldPhase === value) {
      return;
    }

    this.state.harmonics[harmonicIx].phase = value;
    this.commit();
  };

  private encodeState = (): Float32Array => {
    const encodedState = new Float32Array(HARMONICS_COUNT * 2);
    // magnitude, phase
    encodedState.set(this.state.harmonics.map(h => h.magnitude));
    encodedState.set(
      this.state.harmonics.map(h => h.phase),
      HARMONICS_COUNT
    );
    console.log('encodedState', encodedState);
    return encodedState;
  };

  private commit = async () => {
    if (!this.engine) {
      return;
    }

    const encodedState = this.encodeState();
    const waveformImagePtr = this.engine.render_waveform(encodedState);
    const waveformImage = this.getWasmMemory().slice(
      waveformImagePtr,
      waveformImagePtr + WAVEFORM_IMAGE_HEIGHT_PX * WAVEFORM_IMAGE_WIDTH_PX * 4
    );
    const imageBitmap = await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(waveformImage),
        WAVEFORM_IMAGE_WIDTH_PX,
        WAVEFORM_IMAGE_HEIGHT_PX
      )
    );

    const texture = PIXI.Texture.from(imageBitmap, {
      width: WAVEFORM_IMAGE_WIDTH_PX,
      height: WAVEFORM_IMAGE_HEIGHT_PX,
      format: PIXI.FORMATS.RGBA,
      type: PIXI.TYPES.UNSIGNED_BYTE,
    });
    if (this.waveformImage) {
      this.waveformImage.texture.destroy(true);
      this.waveformImage.texture = texture;
    }
  };

  public destroy() {
    this.app.destroy(false, { children: true, texture: true, baseTexture: true });
  }
}
