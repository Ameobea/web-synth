import * as PIXI from 'src/controls/pixi';
import { destroyPIXIApp } from 'src/controls/pixiUtils';
import { logError } from 'src/sentry';

const dpr = window.devicePixelRatio || 1;

const MIXER_LEVELS_VIZ_WIDTH_PX = 500;
const MIXER_LEVELS_VIZ_HEIGHT_PER_INPUT_PX = 40;
const BACKGROUND_COLOR = 0x040404;
const MARGIN_TOP_PX = 160;

const LEVEL_METER_VERTICAL_SPACING_PX = 20;
const LEVEL_METER_MIN_DB = -60;
const LEVEL_METER_MAX_DB = 20;
const LEVEL_METER_TICK_SPACING_DB = 10;
const LEVEL_METER_LABEL_TICK_COLOR = 0x666666;
const LEVEL_METER_YELLOW_DB = -10;
const LEVEL_METER_RED_DB = 0;
const LEVEL_METER_BAR_HEIGHT_PX = 4;
const LEVEL_METER_BAR_VERTICAL_SPACING_PX = 1;
const LEVEL_METER_TICK_HEIGHT_PX = 4;
const LEVEL_METER_LABEL_FONT_SIZE_PX = 8;
const LEVEL_METER_LABEL_FONT_COLOR = 0xefefef;
const LEVEL_METER_GREEN_COLOR = 0x00ff00;
const LEVEL_METER_YELLOW_COLOR = 0xffff00;
const LEVEL_METER_RED_COLOR = 0xff0000;

const dbToXPx = (db: number): number => {
  return (
    (MIXER_LEVELS_VIZ_WIDTH_PX * (db - LEVEL_METER_MIN_DB)) /
    (LEVEL_METER_MAX_DB - LEVEL_METER_MIN_DB)
  );
};

const buildLevelMeterTicksTexture = (renderer: PIXI.Renderer): PIXI.Texture => {
  // There are two horizontal bars, one for pre and one for post, and the ticks are displayed beneath both.
  const g = new PIXI.Graphics();
  g.beginFill(LEVEL_METER_LABEL_TICK_COLOR);

  const tickCount = Math.floor(
    (LEVEL_METER_MAX_DB - LEVEL_METER_MIN_DB) / LEVEL_METER_TICK_SPACING_DB
  );
  for (let i = 0; i < tickCount; i++) {
    const db = LEVEL_METER_MIN_DB + i * LEVEL_METER_TICK_SPACING_DB;
    const x = dbToXPx(db);
    g.drawRect(x, 0, 1, LEVEL_METER_TICK_HEIGHT_PX);
  }
  g.endFill();

  // labels
  const labelStyle = new PIXI.TextStyle({
    fontFamily: 'Hack',
    fontSize: LEVEL_METER_LABEL_FONT_SIZE_PX,
    fill: LEVEL_METER_LABEL_FONT_COLOR,
  });

  for (let i = 0; i < tickCount; i++) {
    const db = LEVEL_METER_MIN_DB + i * LEVEL_METER_TICK_SPACING_DB;
    const text = db.toFixed(0);
    const x = dbToXPx(db) - (text.length * 5) / 2;
    const label = new PIXI.Text(text, labelStyle);
    label.x = x;
    label.y = LEVEL_METER_TICK_HEIGHT_PX + 2;
    g.addChild(label);
  }

  return renderer.generateTexture(g);
};

let CachedLevelMeterTicksTexture: PIXI.Texture | null = null;
const getLevelMeterTicksTexture = (renderer: PIXI.Renderer): PIXI.Texture => {
  if (!CachedLevelMeterTicksTexture) {
    CachedLevelMeterTicksTexture = buildLevelMeterTicksTexture(renderer);
  }
  return CachedLevelMeterTicksTexture;
};

class LevelMeter {
  private c: PIXI.Container;
  private topBar: PIXI.Graphics;
  private bottomBar: PIXI.Graphics;

  public get displayObject(): PIXI.DisplayObject {
    return this.c;
  }

  constructor(renderer: PIXI.Renderer) {
    this.c = new PIXI.Container();
    const ticksSprite = new PIXI.Sprite(getLevelMeterTicksTexture(renderer));
    ticksSprite.y = LEVEL_METER_BAR_HEIGHT_PX + LEVEL_METER_BAR_VERTICAL_SPACING_PX;
    this.c.addChild(ticksSprite);

    this.topBar = new PIXI.Graphics();
    this.c.addChild(this.topBar);

    this.bottomBar = new PIXI.Graphics();
    this.bottomBar.y = LEVEL_METER_BAR_HEIGHT_PX + LEVEL_METER_BAR_VERTICAL_SPACING_PX;
    this.c.addChild(this.bottomBar);
  }

  private renderBar = (bar: PIXI.Graphics, level: number) => {
    bar.clear();

    bar.beginFill(LEVEL_METER_GREEN_COLOR);
    const greenBarWidth = Math.min(dbToXPx(LEVEL_METER_YELLOW_DB), dbToXPx(level));
    bar.drawRect(0, 0, greenBarWidth, LEVEL_METER_BAR_HEIGHT_PX);
    bar.endFill();

    const yellowBarWidth = Math.min(dbToXPx(LEVEL_METER_RED_DB), dbToXPx(level)) - greenBarWidth;
    if (level > LEVEL_METER_YELLOW_DB) {
      bar.beginFill(LEVEL_METER_YELLOW_COLOR);
      bar.drawRect(greenBarWidth, 0, yellowBarWidth, LEVEL_METER_BAR_HEIGHT_PX);
      bar.endFill();
    }

    if (level > LEVEL_METER_RED_DB) {
      bar.beginFill(LEVEL_METER_RED_COLOR);
      const redBarWidth = dbToXPx(level) - greenBarWidth - yellowBarWidth;
      bar.drawRect(greenBarWidth + yellowBarWidth, 0, redBarWidth, LEVEL_METER_BAR_HEIGHT_PX);
      bar.endFill();
    }
  };

  public setLevels = (preLevel: number, postLevel: number) => {
    this.renderBar(this.topBar, preLevel);
    this.renderBar(this.bottomBar, postLevel);
  };
}

export class MixerLevelsViz {
  private app: PIXI.Application;
  private audioThreadBuffer: Float32Array | null = null;

  private levelMetersContainer: PIXI.Container;
  private levelMeters: LevelMeter[] = [];

  constructor(canvas: HTMLCanvasElement, inputCount: number) {
    try {
      this.app = new PIXI.Application({
        antialias: true,
        autoDensity: true,
        resolution: dpr,
        view: canvas,
        height:
          MARGIN_TOP_PX +
          (MIXER_LEVELS_VIZ_HEIGHT_PER_INPUT_PX + LEVEL_METER_VERTICAL_SPACING_PX) * inputCount,
        width: MIXER_LEVELS_VIZ_WIDTH_PX,
        backgroundColor: BACKGROUND_COLOR,
      });
    } catch (err) {
      logError('Failed to initialize PixiJS applicationl; WebGL not supported?');
      throw err;
    }

    this.levelMetersContainer = new PIXI.Container();
    this.renderInitialLevelMeters(inputCount);

    this.app?.ticker.add(() => {
      if (!this.audioThreadBuffer) {
        return;
      }

      for (let meterIx = 0; meterIx < this.levelMeters.length; meterIx += 1) {
        const meter = this.levelMeters[meterIx];
        const preLevel = this.audioThreadBuffer[meterIx * 2];
        const postLevel = this.audioThreadBuffer[meterIx * 2 + 1];
        meter.setLevels(preLevel, postLevel);
      }
    });
  }

  private renderInitialLevelMeters = (inputCount: number) => {
    for (let i = 0; i < inputCount; i++) {
      const meter = new LevelMeter(this.app.renderer as PIXI.Renderer);
      this.levelMeters.push(meter);
      meter.displayObject.y =
        MARGIN_TOP_PX +
        i * (LEVEL_METER_VERTICAL_SPACING_PX + MIXER_LEVELS_VIZ_HEIGHT_PER_INPUT_PX);
      this.levelMetersContainer.addChild(meter.displayObject);
    }
    this.app.stage.addChild(this.levelMetersContainer);
  };

  public setAudioThreadBuffer = (audioThreadBuffer: Float32Array) => {
    this.audioThreadBuffer = audioThreadBuffer;
  };

  public setInputCount = (inputCount: number) => {
    // TODO
  };

  public destroy = () => {
    destroyPIXIApp(this.app);
    CachedLevelMeterTicksTexture?.destroy();
    CachedLevelMeterTicksTexture = null;
  };
}
