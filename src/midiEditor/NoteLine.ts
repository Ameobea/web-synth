import { UnreachableException } from 'ameo-utils';
import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import MIDIEditorUIInstance, { type Note } from 'src/midiEditor/MIDIEditorUIInstance';
import MIDINoteBox from 'src/midiEditor/NoteBox/MIDINoteBox';
import { NoteBox } from 'src/midiEditor/NoteBox/NoteBox';
import * as conf from './conf';

export interface NoteCreationState {
  /**
   * Point that the mouse went down at regardless of what direction they moved in after that
   */
  originalPosBeats: number;
  startPositionBeats: number;
  endPositionBeats: number;
  id: number | null;
}

/**
 * A cache for storing line marker sprites keyed by `pxPerBeat`
 */
const MarkersCache: Map<number, PIXI.Graphics> = new Map();

export default class NoteLine {
  public app: MIDIEditorUIInstance;
  public notesByID: Map<number, NoteBox> = new Map();
  public container: PIXI.Container;
  public background: PIXI.DisplayObject;
  public index: number;
  private graphics: PIXI.Graphics | undefined;
  private noteCreationState: NoteCreationState | null = null;
  private isCulled = true;
  /**
   * Used for markings caching to determine whether we need to re-render markings or not
   */
  private lastPxPerBeat = 0;

  constructor(
    app: MIDIEditorUIInstance,
    notes: Note[],
    index: number,
    NoteBoxClass: typeof NoteBox = MIDINoteBox,
    enableNoteCreation = true
  ) {
    this.app = app;
    this.index = index;
    this.container = new PIXI.Container();
    this.background = new PIXI.Container();
    this.background.hitArea = new PIXI.Rectangle(0, 0, this.app.width, conf.LINE_HEIGHT);
    this.background.interactive = true;
    this.container.addChild(this.background);
    this.container.width = this.app.width;
    this.container.y = index * conf.LINE_HEIGHT - this.app.managedInst.view.scrollVerticalPx;

    notes.forEach(note => {
      const noteBox = new NoteBoxClass(this, note);
      this.app.allNotesByID.set(note.id, noteBox);
      this.notesByID.set(note.id, noteBox);
    });
    if (enableNoteCreation) {
      this.installNoteCreationHandlers();
    }
    this.handleViewChange();
  }

  private installNoteCreationHandlers() {
    this.background
      .on('pointerdown', (evt: any) => {
        if (evt.data.button !== 0 || this.app.selectionBoxButtonDown) {
          return;
        }

        const data: PIXI.InteractionData = evt.data;
        const posBeats = this.app.parentInstance.snapBeat(
          this.app.pxToBeats(data.getLocalPosition(this.background).x) +
            this.app.parentInstance.baseView.scrollHorizontalBeats
        );
        const isBlocked = !this.app.wasm!.instance.check_can_add_note(
          this.app.wasm!.noteLinesCtxPtr,
          this.index,
          posBeats,
          0
        );
        this.app.gate(this.index);
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
      })
      .on('pointermove', (evt: any) => {
        if (!this.noteCreationState) {
          return;
        }

        const data: PIXI.InteractionData = evt.data;
        const newPosBeats = this.app.parentInstance.snapBeat(
          this.app.pxToBeats(data.getLocalPosition(this.background).x) +
            this.app.parentInstance.baseView.scrollHorizontalBeats
        );
        let [newStartPosBeats, newEndPosBeats] = [
          Math.min(newPosBeats, this.noteCreationState.originalPosBeats),
          Math.max(newPosBeats, this.noteCreationState.originalPosBeats),
        ];
        const noteLengthPx = this.app.beatsToPx(newEndPosBeats - newStartPosBeats);
        if (!this.app.wasm) {
          throw new UnreachableException();
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
            this.noteCreationState.endPositionBeats - this.noteCreationState.startPositionBeats
          );
        }
      });
  }

  public handleViewChange() {
    const newY = Math.max(
      -conf.LINE_HEIGHT,
      Math.round(this.index * conf.LINE_HEIGHT - this.app.managedInst.view.scrollVerticalPx)
    );
    const isCulled = this.container.y + conf.LINE_HEIGHT < 0 || this.container.y > this.app.height;
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
    for (const note of this.notesByID.values()) {
      note.render();
    }
  }

  private buildMarkers(): PIXI.Graphics {
    const cached = MarkersCache.get(this.app.parentInstance.baseView.pxPerBeat);
    if (cached) {
      return cached.clone();
    }

    const g = new PIXI.Graphics();
    // bottom border
    g.lineStyle(1, conf.LINE_BORDER_COLOR);
    g.moveTo(0, conf.LINE_HEIGHT);
    g.lineTo(this.app.width * 2, conf.LINE_HEIGHT);

    let beat = 0;
    const visibleBeats = this.app.width / this.app.parentInstance.baseView.pxPerBeat;
    const endBeat = Math.floor(visibleBeats) + 20;
    while (beat <= endBeat) {
      const isMeasureLine = beat % this.app.parentInstance.baseView.beatsPerMeasure === 0;
      let x = this.app.beatsToPx(beat);
      if (isMeasureLine) {
        x = Math.round(x);
        g.lineStyle(1, conf.MEASURE_LINE_COLOR);
        g.moveTo(x, 0);
        g.lineTo(x, conf.LINE_HEIGHT - 0);
      } else {
        g.lineStyle(0.8, conf.NOTE_MARK_COLOR);
        g.moveTo(x, conf.LINE_HEIGHT * 0.87);
        g.lineTo(x, conf.LINE_HEIGHT);
      }
      beat += 1;
    }

    g.cacheAsBitmap = true;
    MarkersCache.set(this.app.parentInstance.baseView.pxPerBeat, g);
    return g.clone();
  }

  private renderMarkers() {
    if (!this.graphics || this.lastPxPerBeat !== this.app.parentInstance.baseView.pxPerBeat) {
      if (this.graphics) {
        this.container.removeChild(this.graphics);
        this.graphics.destroy();
      }

      this.graphics = this.buildMarkers();
      this.container.addChild(this.graphics);
      // after background, before notes
      this.container.setChildIndex(this.graphics, 1);
      this.lastPxPerBeat = this.app.parentInstance.baseView.pxPerBeat;
    }

    const xOffsetBeats = -(
      this.app.parentInstance.baseView.scrollHorizontalBeats %
      this.app.parentInstance.baseView.beatsPerMeasure
    );
    this.graphics.x = this.app.beatsToPx(xOffsetBeats);
  }

  public destroy() {
    for (const note of this.notesByID.values()) {
      note.destroy();
    }
    this.container.destroy();
    this.app.linesContainer.removeChild(this.container);
  }
}
