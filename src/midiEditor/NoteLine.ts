import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import type { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import MIDINoteBox from 'src/midiEditor/NoteBox/MIDINoteBox';
import type { NoteBox } from 'src/midiEditor/NoteBox/NoteBox';
import * as conf from './conf';
import type { FederatedPointerEvent } from '@pixi/events';
import { UnreachableError } from 'src/util';

export interface NoteCreationState {
  /**
   * Point that the mouse went down at regardless of what direction they moved in after that
   */
  originalPosBeats: number;
  startPositionBeats: number;
  endPositionBeats: number;
  id: number | null;
}

export default class NoteLine {
  public app: MIDIEditorUIInstance;
  public notesByID: Map<number, NoteBox> = new Map();
  public container: PIXI.Container;
  public background: PIXI.Graphics;
  public index: number;
  private markers: PIXI.Sprite | undefined;
  private lines: PIXI.Sprite | undefined;
  private noteCreationState: NoteCreationState | null = null;
  private isCulled = true;
  private isDestroyed = false;
  private labelText: PIXI.Text | undefined;
  private enableNoteCreation;

  /**
   * Used for markings caching to determine whether we need to re-render markings or not
   */
  private lastPxPerBeat = 0;
  private lastBeatsPerMeasure = 0;
  private lastWidthPx = 0;

  constructor(
    app: MIDIEditorUIInstance,
    notes: Note[],
    index: number,
    NoteBoxClass: typeof NoteBox = MIDINoteBox,
    enableNoteCreation = true
  ) {
    this.app = app;
    this.index = index;
    this.enableNoteCreation = enableNoteCreation;
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.container.interactiveChildren = true;
    const midiNumber = this.app.managedInst.lineCount - this.index;
    const noteInOctaveIx = midiNumber % 12;
    const isAccidental =
      noteInOctaveIx === 1 ||
      noteInOctaveIx === 3 ||
      noteInOctaveIx === 6 ||
      noteInOctaveIx === 8 ||
      noteInOctaveIx === 10;
    this.background = new PIXI.Graphics();
    this.background.zIndex = 0;
    this.background.beginFill(
      isAccidental ? conf.BLACK_NOTE_LINE_COLOR : conf.WHITE_NOTE_LINE_COLOR
    );
    this.background.drawRect(0, 0, this.app.width, conf.LINE_HEIGHT - 1);
    this.background.endFill();
    this.background.hitArea = new PIXI.Rectangle(0, 0, this.app.width, conf.LINE_HEIGHT);
    this.background.interactive = true;
    this.container.addChild(this.background);
    this.container.width = this.app.width;
    this.container.y = index * conf.LINE_HEIGHT - this.app.managedInst.view.scrollVerticalPx;

    notes.forEach(note => {
      const noteBox = new NoteBoxClass(
        this,
        note,
        this.app.parentInstance.uiManager.velocityDisplayEnabled
      );
      this.app.allNotesByID.set(note.id, noteBox);
      this.notesByID.set(note.id, noteBox);
    });

    this.handleViewChange();
    if (enableNoteCreation) {
      this.installNoteCreationHandlers();
    }
  }

  private handlePointerMove = (evt: FederatedPointerEvent) => {
    if (!this.noteCreationState) {
      return;
    }

    const newPosBeats = this.app.parentInstance.snapBeat(
      this.app.pxToBeats(evt.getLocalPosition(this.background).x) +
        this.app.parentInstance.baseView.scrollHorizontalBeats
    );
    let [newStartPosBeats, newEndPosBeats] = [
      Math.min(newPosBeats, this.noteCreationState.originalPosBeats),
      Math.max(newPosBeats, this.noteCreationState.originalPosBeats),
    ];
    const noteLengthPx = this.app.beatsToPx(newEndPosBeats - newStartPosBeats);
    if (!this.app.wasm) {
      throw new UnreachableError();
    }
    if (!R.isNil(this.noteCreationState.id) && noteLengthPx < conf.MIN_DRAWING_NOTE_WIDTH_PX) {
      // End is too close to the start; delete the not that we had created here
      this.app.deleteNote(this.noteCreationState.id);
      this.noteCreationState.id = null;
    } else {
      // Resize the drawing note to match the new start and end point
      if (
        newStartPosBeats !== this.noteCreationState.startPositionBeats &&
        !R.isNil(this.noteCreationState.id)
      ) {
        newStartPosBeats = this.app.resizeNoteHorizontalStart(
          this.index,
          this.noteCreationState.startPositionBeats,
          this.noteCreationState.id,
          newStartPosBeats
        );
      } else if (
        newEndPosBeats !== this.noteCreationState.endPositionBeats &&
        !R.isNil(this.noteCreationState.id)
      ) {
        newEndPosBeats = this.app.resizeNoteHorizontalEnd(
          this.index,
          this.noteCreationState.startPositionBeats,
          this.noteCreationState.id,
          newEndPosBeats
        );
      }
    }

    this.noteCreationState.startPositionBeats = newStartPosBeats;
    this.noteCreationState.endPositionBeats = newEndPosBeats;

    if (R.isNil(this.noteCreationState.id) && noteLengthPx >= conf.MIN_DRAWING_NOTE_WIDTH_PX) {
      this.noteCreationState.id = this.app.addNote(
        this.index,
        this.noteCreationState.startPositionBeats,
        this.noteCreationState.endPositionBeats - this.noteCreationState.startPositionBeats,
        // TODO: velocity correct here?
        this.app.managedInst.lastSetNoteVelocity
      );
    }
  };

  private uninstallNoteCreationHandlers: (() => void) | undefined;
  private installNoteCreationHandlers() {
    this.uninstallNoteCreationHandlers?.();
    this.uninstallNoteCreationHandlers = undefined;

    const handlePointerDown = (evt: FederatedPointerEvent) => {
      console.log('pointerdown');
      if (evt.button !== 0 || this.app.selectionBoxButtonDown) {
        return;
      }

      const posBeats = this.app.parentInstance.snapBeat(
        this.app.pxToBeats(evt.getLocalPosition(this.background).x) +
          this.app.parentInstance.baseView.scrollHorizontalBeats
      );
      const isBlocked = !this.app.wasm!.instance.check_can_add_note(
        this.app.wasm!.noteLinesCtxPtr,
        this.index,
        posBeats,
        0
      );
      this.app.gate(this.index, 90);
      if (isBlocked) {
        return;
      }

      this.app.deselectAllNotes();
      this.noteCreationState = {
        originalPosBeats: posBeats,
        startPositionBeats: posBeats,
        id: null,
        endPositionBeats: posBeats,
      };

      this.app.addMouseUpCB(() => {
        this.noteCreationState = null;
        this.app.ungate(this.index);
      });
    };

    this.background.on('pointerdown', handlePointerDown);
    const lines = this.lines;
    if (lines) {
      lines.on('pointerdown', handlePointerDown);
    } else {
    }

    this.app.app.stage.on('pointermove', this.handlePointerMove);

    this.uninstallNoteCreationHandlers = () => {
      this.background.off('pointerdown', handlePointerDown);
      lines?.off('pointerdown', handlePointerDown);
      this.app.app.stage.off('pointermove', this.handlePointerMove);
    };
  }

  public handleViewChange() {
    const newY = Math.round(
      this.index * conf.LINE_HEIGHT - this.app.managedInst.view.scrollVerticalPx + 0.5
    );
    const isCulled = newY + conf.LINE_HEIGHT < 0 || newY > this.app.height;
    if (!isCulled && this.isCulled) {
      this.isCulled = isCulled;
      this.app.linesContainer.addChild(this.container);
    } else if (isCulled && !this.isCulled) {
      this.isCulled = isCulled;
      this.app.linesContainer.removeChild(this.container);
      return;
    }
    this.container.y = newY;

    this.renderMarkers();
    this.container.sortChildren();
    for (const note of this.notesByID.values()) {
      note.render();
    }
  }

  private buildLines(): PIXI.Sprite {
    const g = new PIXI.Graphics();
    g.zIndex = 2;
    g.lineStyle(1, conf.LINE_BORDER_COLOR);
    g.moveTo(0, conf.LINE_HEIGHT);
    g.lineTo(this.app.width, conf.LINE_HEIGHT);

    const renderTexture = PIXI.RenderTexture.create({
      width: this.app.width,
      height: conf.LINE_HEIGHT,
    });
    this.app.app.renderer.render(g, { renderTexture });

    return new PIXI.Sprite(renderTexture);
  }

  private buildMarkers(): PIXI.Sprite {
    const pxPerBeat = this.app.parentInstance.baseView.pxPerBeat;
    const markersCacheKey = `${pxPerBeat}-${this.app.parentInstance.baseView.beatsPerMeasure}`;
    const cached = this.app.markersCache.get(markersCacheKey);
    if (cached?.baseTexture?.valid) {
      return new PIXI.Sprite(cached);
    } else {
      cached?.destroy(true);
    }

    const g = new PIXI.Graphics();
    g.zIndex = 3;

    let beatsPerTick = 1;
    let beatsPerMeasureLine = this.app.parentInstance.baseView.beatsPerMeasure;
    let pxPerMeasure = this.app.beatsToPx(beatsPerMeasureLine);
    while (pxPerMeasure < conf.MIN_MEASURE_WIDTH_PX) {
      beatsPerMeasureLine *= 2;
      beatsPerTick *= 2;
      pxPerMeasure = this.app.beatsToPx(beatsPerMeasureLine);
    }

    let beat = 0;
    const visibleBeats = this.app.width / this.app.parentInstance.baseView.pxPerBeat;
    const endBeat = Math.ceil(visibleBeats);
    while (beat <= endBeat) {
      const isMeasureLine = beat % beatsPerMeasureLine === 0;
      let x = this.app.beatsToPx(beat);
      if (isMeasureLine) {
        x = Math.round(x);
        g.lineStyle(1, conf.MEASURE_LINE_COLOR);
        g.moveTo(x, 0);
        g.lineTo(x, conf.LINE_HEIGHT - 0);
      } else {
        g.lineStyle(1, conf.NOTE_MARK_TICK_COLOR);
        g.moveTo(x, conf.LINE_HEIGHT * 0.82);
        g.lineTo(x, conf.LINE_HEIGHT);
      }
      beat += beatsPerTick;
    }

    const renderTexture = PIXI.RenderTexture.create({
      width: this.app.width,
      height: conf.LINE_HEIGHT,
    });
    this.app.app.renderer.render(g, { renderTexture });

    this.app.markersCache.set(markersCacheKey, renderTexture);
    return new PIXI.Sprite(renderTexture);
  }

  private renderMarkers() {
    if (this.isCulled) {
      this.uninstallNoteCreationHandlers?.();

      if (this.markers) {
        this.container.removeChild(this.markers);
        this.markers.destroy();
        this.markers = undefined;
      }

      this.lines?.destroy();
      this.lines = undefined;

      return;
    }

    if (
      !this.markers ||
      this.lastPxPerBeat !== this.app.parentInstance.baseView.pxPerBeat ||
      this.lastBeatsPerMeasure !== this.app.parentInstance.baseView.beatsPerMeasure
    ) {
      if (this.markers) {
        this.container.removeChild(this.markers);
        this.markers.destroy();
      }

      this.markers = this.buildMarkers();
      this.container.addChild(this.markers);
      this.lastPxPerBeat = this.app.parentInstance.baseView.pxPerBeat;
      this.lastBeatsPerMeasure = this.app.parentInstance.baseView.beatsPerMeasure;
    }

    if (!this.lines || this.lastWidthPx !== this.app.width) {
      if (this.lines) {
        this.container.removeChild(this.lines);
        this.lines.destroy();
      }

      this.lines = this.buildLines();
      this.lines.interactive = true;
      this.container.addChild(this.lines);
      this.lastWidthPx = this.app.width;

      if (this.enableNoteCreation) {
        this.installNoteCreationHandlers();
      }
    }

    const xOffsetBeats = -(
      this.app.parentInstance.baseView.scrollHorizontalBeats %
      this.app.parentInstance.baseView.beatsPerMeasure
    );
    this.markers.x = this.app.beatsToPx(xOffsetBeats);
  }

  public setLabel(text: string | undefined) {
    if (text) {
      if (!this.labelText) {
        this.labelText = new PIXI.Text(text, {
          fontSize: 12,
          fill: conf.LINE_LABEL_COLOR,
          fontFamily: 'Hack',
        });
        this.labelText.x = 4;
        this.labelText.y = 1;
        this.container.addChild(this.labelText);
      } else {
        this.labelText.text = text;
      }
    } else if (this.labelText) {
      this.container.removeChild(this.labelText);
      this.labelText.destroy();
      this.labelText = undefined;
    }
  }

  public destroy() {
    if (this.isDestroyed) {
      console.warn('Attempted to destroy a note line that was already destroyed');
    }
    this.isDestroyed = true;

    for (const note of this.notesByID.values()) {
      note.destroy();
    }
    this.container.destroy();
    this.app.linesContainer.removeChild(this.container);
    this.app.app.stage.off('pointermove', this.handlePointerMove);
  }
}
