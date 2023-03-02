import * as Comlink from 'comlink';
import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import { makeDraggable } from 'src/controls/pixiUtils';
import { WavetableConfiguratorWorker } from 'src/fmSynth/Wavetable/WavetableConfiguratorWorker.worker';
import WaveTable, {
  type WavetableDef,
} from 'src/graphEditor/nodes/CustomAudio/WaveTable/WaveTable';
import { getSentry } from 'src/sentry';
import { AsyncOnce, SAMPLE_RATE } from 'src/util';

const dpr = window.devicePixelRatio ?? 1;

const BACKGROUND_COLOR = 0x020202;
export const BUILD_WAVETABLE_INST_HEIGHT_PX = 800;
export const BUILD_WAVETABLE_INST_WIDTH_PX = Math.round(BUILD_WAVETABLE_INST_HEIGHT_PX * 1.618);

const HARMONICS_COUNT = 64;
const WAVEFORM_LENGTH_SAMPLES = 1024 * 4;

const SLIDER_BG_COLOR = 0x1f1f1f;
const SLIDER_BORDER_COLOR = 0x2f2f2f;
const SLIDER_WIDTH = 19;
const SLIDER_HEIGHT = 160;
const SLIDER_LABEL_COLOR = 0x727272;
const SLIDER_LABEL_FONT_FAMILY = 'Hack';
const SLIDER_LABEL_FONT_SIZE = 9.5;
const SLIDER_HANDLE_COLOR = 0x4a4a4a;
const SLIDER_HANDLE_HEIGHT = 8;
const SLIDER_GHOST_TICK_HEIGHT = 4;
const SLIDER_GHOST_TICK_PHASE_COLOR = 0x798dbd;
const SLIDER_GHOST_TICK_MAGNITUDE_COLOR = 0x83c996;

const WAVEFORM_IMAGE_HEIGHT_PX = 256;
const WAVEFORM_IMAGE_WIDTH_PX = 1024;

export enum BuildWavetableSliderMode {
  Magnitude,
  Phase,
}

export interface BuildWavetableInstanceState {
  harmonics: { magnitude: number; phase: number }[];
  sliderMode: BuildWavetableSliderMode;
}

const buildDefaultBuildWavetableInstanceState = (): BuildWavetableInstanceState => ({
  harmonics: new Array(HARMONICS_COUNT)
    .fill(null)
    .map((_, i) => ({ magnitude: i === 1 ? 1 : 0, phase: 0 })),
  sliderMode: BuildWavetableSliderMode.Magnitude,
});

const WavegenWasm = new AsyncOnce(
  () =>
    fetch(
      process.env.ASSET_PATH +
        'wavegen.wasm' +
        (window.location.host.includes('localhost') ? '' : `?${crypto.randomUUID()}`)
    ).then(res => res.arrayBuffer()),
  true
);

/**
 * Expects values to be in the range [0, 1].
 */
class VerticalSlider {
  private bg: PIXI.Graphics;
  private handle: PIXI.Graphics;
  private onChange: (value: number) => void;
  private value: number;
  private ghostValue: number;
  private ghostTickMode: BuildWavetableSliderMode;
  public dragData: PIXI.InteractionData | null = null;

  public get graphics() {
    return this.bg;
  }

  private renderBackgroundGraphics(bg: PIXI.Graphics) {
    const ghostTickY =
      SLIDER_HEIGHT -
      SLIDER_GHOST_TICK_HEIGHT -
      this.ghostValue * (SLIDER_HEIGHT - SLIDER_GHOST_TICK_HEIGHT) +
      1;
    bg.beginFill(SLIDER_BG_COLOR)
      .drawRect(0, 0, SLIDER_WIDTH, SLIDER_HEIGHT)
      .endFill()
      .lineStyle(1, SLIDER_BORDER_COLOR)
      .drawRect(0, 0, SLIDER_WIDTH, SLIDER_HEIGHT)
      // ghost tick
      .lineStyle(
        1,
        this.ghostTickMode === BuildWavetableSliderMode.Magnitude
          ? SLIDER_GHOST_TICK_MAGNITUDE_COLOR
          : SLIDER_GHOST_TICK_PHASE_COLOR
      )
      .moveTo(0, ghostTickY)
      .lineTo(SLIDER_WIDTH, ghostTickY);
  }

  constructor(
    onChange: (value: number) => void,
    initialValue: number,
    initialGhostValue: number,
    initialGhostTickMode: BuildWavetableSliderMode,
    ix: number
  ) {
    this.onChange = onChange;
    this.value = initialValue;
    this.ghostValue = initialGhostValue;
    this.ghostTickMode = initialGhostTickMode;

    this.bg = new PIXI.Graphics();
    this.renderBackgroundGraphics(this.bg);
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

  public setValue(newValue: number, ghostValue: number, ghostTickMode: BuildWavetableSliderMode) {
    this.value = newValue;
    this.ghostValue = ghostValue;
    this.ghostTickMode = ghostTickMode;
    this.bg.clear();
    this.renderBackgroundGraphics(this.bg);
    this.handle.y = (1 - this.value) * (SLIDER_HEIGHT - SLIDER_HANDLE_HEIGHT);
  }
}

const buildPlaceholderWavetableDef = (): WavetableDef => [
  [new Float32Array(WAVEFORM_LENGTH_SAMPLES)],
];

export class BuildWavetableInstance {
  private ctx = new AudioContext();
  private app: PIXI.Application;
  private worker: Comlink.Remote<WavetableConfiguratorWorker>;
  private waveformImage: PIXI.Sprite;
  private waveformContainer: PIXI.Container;
  private slidersContainer: PIXI.Container;
  private sliders: VerticalSlider[] = [];
  private commitDispatchSeq = 0;
  private commitRenderSeq = 0;
  private wavetable: WaveTable;
  private gainNode: GainNode;
  private frequencyCSN: ConstantSourceNode;

  private state: BuildWavetableInstanceState = buildDefaultBuildWavetableInstanceState();

  constructor(canvas: HTMLCanvasElement) {
    this.worker = Comlink.wrap(
      new Worker(new URL('./WavetableConfiguratorWorker.worker.ts', import.meta.url))
    );
    WavegenWasm.get().then(async wasm => {
      await this.worker.setWasmBytes(Comlink.transfer(wasm, [wasm]));
      this.commit();
    });

    this.gainNode = new GainNode(this.ctx);
    this.frequencyCSN = new ConstantSourceNode(this.ctx);
    this.wavetable = new WaveTable(this.ctx, '', {
      wavetableDef: buildPlaceholderWavetableDef(),
      onInitialized: (wavetable: WaveTable) => {
        wavetable.workletHandle!.connect(this.gainNode);
        this.frequencyCSN.connect(
          (wavetable.workletHandle!.parameters as Map<string, AudioParam>).get('frequency')!
        );
        this.frequencyCSN.start();
      },
    });

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
        this.state.harmonics[harmonicIx].phase,
        BuildWavetableSliderMode.Magnitude,
        harmonicIx
      );
      slider.graphics.x = harmonicIx * SLIDER_WIDTH;
      slider.graphics.y = 10;
      this.slidersContainer.addChild(slider.graphics);
      this.sliders.push(slider);
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

  public setSliderMode = (sliderMode: BuildWavetableSliderMode) => {
    this.state.sliderMode = sliderMode;
    for (let harmonicIx = 0; harmonicIx < HARMONICS_COUNT; harmonicIx++) {
      if (harmonicIx === 0) {
        continue;
      }

      const slider = this.sliders[harmonicIx - 1];
      if (sliderMode === BuildWavetableSliderMode.Magnitude) {
        slider.setValue(
          this.state.harmonics[harmonicIx].magnitude,
          this.state.harmonics[harmonicIx].phase,
          BuildWavetableSliderMode.Phase
        );
      } else {
        slider.setValue(
          this.state.harmonics[harmonicIx].phase,
          this.state.harmonics[harmonicIx].magnitude,
          BuildWavetableSliderMode.Magnitude
        );
      }
    }
  };

  public setIsPlaying = (isPlaying: boolean) => {
    if (isPlaying) {
      this.gainNode.connect(this.ctx.destination);
    } else {
      try {
        this.gainNode.disconnect();
      } catch (err) {
        // pass
      }
    }
  };

  public setVolumeDb = (volumeDb: number) => {
    const gain = Math.pow(10, volumeDb / 20);
    console.log('gain', gain);
    this.gainNode.gain.value = gain;
  };

  public setFrequency = (frequency: number) => {
    this.frequencyCSN.offset.value = frequency;
  };

  private handleSliderChange = (sliderIx: number, value: number) => {
    if (this.state.sliderMode === BuildWavetableSliderMode.Magnitude) {
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

  private commit = async () => {
    const dispatchID = this.commitDispatchSeq++;
    const res = await this.worker.renderWaveform(this.state.harmonics).catch(err => {
      console.error('Failed to render waveform image', err);
      getSentry()?.captureException(err);
      return null;
    });
    if (!res || this.commitRenderSeq > dispatchID) {
      return;
    }
    const { waveformImage, waveformSamples } = res;

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

    this.waveformImage.texture.destroy(true);
    this.waveformImage.texture = texture;

    this.commitRenderSeq = dispatchID;

    // We need to compute the frequency of the base harmonic, which has a wavelength of `WAVEFORM_LENGTH_SAMPLES`.
    const baseFrequency = SAMPLE_RATE / WAVEFORM_LENGTH_SAMPLES;
    // normalize the samples to [-1, 1]
    const maxSample = Math.max(...waveformSamples);
    const minSample = Math.min(...waveformSamples);
    const maxAbsSample = Math.max(Math.abs(maxSample), Math.abs(minSample));
    if (maxAbsSample > 0) {
      for (let i = 0; i < waveformSamples.length; i++) {
        waveformSamples[i] /= maxAbsSample;
      }
    }
    this.wavetable.setWavetableDef([[waveformSamples]], baseFrequency);
  };

  public destroy() {
    this.app.destroy(false, { children: true, texture: true, baseTexture: true });
    this.wavetable.shutdown();
    this.gainNode.disconnect();
    this.frequencyCSN.disconnect();
  }
}
