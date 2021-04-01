import { UnimplementedError, UnreachableException } from 'ameo-utils';
import * as PIXI from 'pixi.js';
import * as R from 'ramda';

import { makeDraggable } from 'src/controls/pixiUtils';
import * as conf from './conf';

export interface Note {
  id: number;
  startPoint: number;
  /**
   * Length of the note in beats
   */
  length: number;
}

export interface MIDIEditorView {
  /**
   * Zoom factor, indicating how many pixels per beat are rendered.
   */
  pxPerBeat: number;
  scrollHorizontalBeats: number;
  scrollVerticalPx: number;
  beatsPerMeasure: number;
}

export interface SerializedMIDIEditor2State {
  lines: { startPoint: number; length: number }[][];
  view: MIDIEditorView;
  selectedNoteIDs: number[];
}

enum NoteDragHandleSide {
  Left,
  Right,
}

class NoteDragHandle {
  private parentNote: NoteBox;
  private graphics: PIXI.Graphics;
  private side: NoteDragHandleSide;
  private downPos: PIXI.Point | null = null;
  private originalPosBeats = 0;

  constructor(parentNote: NoteBox, side: NoteDragHandleSide) {
    this.parentNote = parentNote;
    this.side = side;
    this.graphics = this.buildInitialGraphics();

    this.render();
  }

  private buildInitialGraphics(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    g.beginFill(0x333333, 0.32);
    g.drawRect(0, 1, 20, conf.LINE_HEIGHT - 2);
    g.endFill();
    this.parentNote.graphics.addChild(g);
    g.interactive = true;
    g.cursor = 'ew-resize';
    g.on('pointerdown', (evt: any) => {
      const data: PIXI.InteractionData = evt.data;
      this.downPos = data.global.clone();
      evt.stopPropagation();
      this.originalPosBeats =
        this.side === NoteDragHandleSide.Left
          ? this.parentNote.note.startPoint
          : this.parentNote.note.startPoint + this.parentNote.note.length;

      this.parentNote.line.app.addMouseUpCB(() => {
        console.log('up');
        this.downPos = null;
      });
    }).on('pointermove', (evt: any) => this.handleDrag(evt.data));
    return g;
  }

  private computeWidth() {
    const noteWidth = this.parentNote.getWidthPx();
    if (noteWidth >= 20) {
      return 8;
    }

    return Math.max(Math.floor((noteWidth - 6) / 2), 1);
  }

  private handleDrag(data: PIXI.InteractionData) {
    if (!this.downPos) {
      return;
    }
    const diffPx = data.global.x - this.downPos.x;
    const diffBeats = this.parentNote.line.app.pxToBeats(diffPx);
    const newPosBeats = this.originalPosBeats + diffBeats;
    if (this.side === NoteDragHandleSide.Left) {
      this.parentNote.line.app.resizeNoteHorizontalStart(
        this.parentNote.line.index,
        this.parentNote.note.startPoint,
        this.parentNote.note.id,
        newPosBeats
      );
    } else {
      this.parentNote.line.app.resizeNoteHorizontalEnd(
        this.parentNote.line.index,
        this.parentNote.note.startPoint,
        this.parentNote.note.id,
        newPosBeats
      );
    }
  }

  public render() {
    const parentNoteWidthPx = this.parentNote.getWidthPx();
    this.graphics!.x =
      this.side === NoteDragHandleSide.Left
        ? 0
        : Math.max(parentNoteWidthPx - this.computeWidth(), 0);
    this.graphics.scale = new PIXI.Point(this.computeWidth() / 20, 1);
  }

  public destroy() {
    if (this.graphics) {
      this.parentNote.graphics.removeChild(this.graphics);
      this.graphics.destroy();
    }
  }
}

class NoteBox {
  public line: NoteLine;
  public note: Note;
  public graphics: PIXI.Graphics;
  private isSelected = false;
  public dragData: PIXI.InteractionData | null = null;
  /**
   * The note-local x offset of the initial click initiating a drag in pixels.  This is used to ensure
   * that the pointer remains at the same point in the note while dragging.
   */
  private dragXOffsetPx = 0;
  private leftDragHandle: NoteDragHandle;
  private rightDragHandle: NoteDragHandle;

  constructor(line: NoteLine, note: Note) {
    this.line = line;
    this.note = note;
    this.graphics = new PIXI.Graphics();
    this.graphics.interactive = true;
    this.graphics.cursor = 'pointer';
    this.graphics.on('pointerdown', (evt: any) => {
      const interactionData: PIXI.InteractionData = evt.data;
      this.dragXOffsetPx = interactionData.global.x - this.line.app.beatsToPx(this.note.startPoint);
      if (this.line.app.selectedNoteIDs.has(this.note.id)) {
        if (this.line.app.multiSelectEnabled) {
          this.line.app.deselectNote(this.note.id);
        } else {
          this.line.app.deselectAllNotes();
        }
      } else {
        this.line.app.selectNote(this.note.id);
      }
    });

    makeDraggable(this.graphics, this);
    this.line.app.addMouseUpCB(() => {
      this.dragData = null;
    });

    this.leftDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Left);
    this.rightDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Right);

    this.render();
  }

  public render() {
    const width = this.note.length * this.line.app.view.pxPerBeat;
    this.graphics.width = width;
    this.graphics.clear();
    this.graphics.lineStyle(1, 0x0);
    this.graphics.beginFill(this.isSelected ? conf.NOTE_SELECTED_COLOR : conf.NOTE_COLOR);
    this.graphics.drawRect(0, 0, width, conf.LINE_HEIGHT - 1);
    this.graphics.endFill();
    this.graphics.x =
      (this.note.startPoint - this.line.app.view.scrollHorizontalBeats) *
      this.line.app.view.pxPerBeat;

    this.line.container.addChild(this.graphics);

    this.leftDragHandle.render();
    this.rightDragHandle.render();
  }

  public handleDrag(newPos: PIXI.Point) {
    const newDesiredStartPos = Math.max(this.line.app.pxToBeats(newPos.x - this.dragXOffsetPx), 0);
    if (!this.line.app.wasm) {
      throw new UnreachableException();
    }

    // TODO: Handle vertical movement

    this.note.startPoint = this.line.app.wasm.instance.move_note_horizontal(
      this.line.app.wasm.noteLinesCtxPtr,
      this.line.index,
      this.note.startPoint,
      this.note.id,
      newDesiredStartPos
    );
    this.render();
  }

  public handleViewChange() {
    throw new UnimplementedError();
    // TODO
  }

  public setIsSelected(isSelected: boolean) {
    this.isSelected = isSelected;
    this.render();
  }

  public getWidthPx(): number {
    return this.line.app.beatsToPx(this.note.length);
  }

  public destroy() {
    this.leftDragHandle.destroy();
    this.rightDragHandle.destroy();
    this.line.container.removeChild(this.graphics);
    this.graphics.destroy();
  }
}

interface NoteCreationState {
  /**
   * Point that the mouse went down at regardless of what direction they moved in after that
   */
  originalPosBeats: number;
  startPositionBeats: number;
  endPositionBeats: number;
  id: number | null;
}

class NoteLine {
  public app: MIDIEditor2Instance;
  public notesByID: Map<number, NoteBox> = new Map();
  public container: PIXI.Container;
  public background: PIXI.Graphics;
  public index: number;
  private graphics!: PIXI.Graphics;
  private noteCreationState: NoteCreationState | null = null;

  constructor(app: MIDIEditor2Instance, notes: Note[], index: number) {
    this.app = app;
    this.index = index;
    this.container = new PIXI.Container();
    this.background = new PIXI.Graphics();
    this.background.lineStyle(1, 0, 0);
    this.background.beginFill(conf.BACKGROUND_COLOR, 1);
    this.background.drawRect(0, 0, this.app.width, conf.LINE_HEIGHT);
    this.background.endFill();
    this.background.interactive = true;
    this.container.addChild(this.background);
    this.container.width = this.app.width;
    this.container.y = index * conf.LINE_HEIGHT;
    notes.forEach(note => {
      const noteBox = new NoteBox(this, note);
      this.app.allNotesByID.set(note.id, noteBox);
      this.notesByID.set(note.id, noteBox);
    });
    this.app.linesContainer.addChild(this.container);
    this.renderMarkers();
    this.installNoteCreationHandlers();
  }

  private installNoteCreationHandlers() {
    this.background
      .on('pointerdown', (evt: any) => {
        this.app.deselectAllNotes();
        const data: PIXI.InteractionData = evt.data;
        const posBeats = this.app.pxToBeats(data.getLocalPosition(this.background).x);
        this.noteCreationState = {
          originalPosBeats: posBeats,
          startPositionBeats: posBeats,
          id: null,
          endPositionBeats: posBeats,
        };

        this.app.addMouseUpCB(() => {
          this.noteCreationState = null;
        });
      })
      .on('pointermove', (evt: any) => {
        if (!this.noteCreationState) {
          return;
        }

        const data: PIXI.InteractionData = evt.data;
        const newPosBeats = this.app.pxToBeats(data.getLocalPosition(this.background).x);
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
    this.renderMarkers();
    for (const note of this.notesByID.values()) {
      note.handleViewChange();
    }
  }

  private renderMarkers() {
    if (this.graphics) {
      this.container.removeChild(this.graphics);
      this.graphics.destroy();
    }
    this.graphics = new PIXI.Graphics();
    let beat = Math.ceil(this.app.view.scrollHorizontalBeats);
    const visibleBeats = this.app.width / this.app.view.pxPerBeat;
    const endBeat = Math.floor(this.app.view.scrollHorizontalBeats + visibleBeats);
    while (beat <= endBeat) {
      const isMeasureLine = beat % this.app.view.beatsPerMeasure === 0;
      const x = this.app.beatsToPx(beat - this.app.view.scrollHorizontalBeats);
      if (isMeasureLine) {
        this.graphics.lineStyle(1, conf.MEASURE_LINE_COLOR);
        this.graphics.moveTo(x, 0);
        this.graphics.lineTo(x, conf.LINE_HEIGHT);
      } else {
        this.graphics.lineStyle(1, conf.NOTE_MARK_COLOR);
        this.graphics.moveTo(x, conf.LINE_HEIGHT * 0.7);
        this.graphics.lineTo(x, conf.LINE_HEIGHT);
      }
      beat += 1;
    }
    this.container.addChild(this.graphics);
  }

  public destroy() {
    for (const note of this.notesByID.values()) {
      note.destroy();
    }
    this.container.destroy();
    this.app.linesContainer.removeChild(this.container);
  }
}

export default class MIDIEditor2Instance {
  public width: number;
  public height: number;
  private app: PIXI.Application;
  public wasm:
    | {
        instance: typeof import('src/note_container');
        noteLinesCtxPtr: number;
      }
    | undefined;
  public linesContainer: PIXI.Container;
  private lines: NoteLine[] = [];
  public view: MIDIEditorView;
  public allNotesByID: Map<number, NoteBox> = new Map();
  public selectedNoteIDs: Set<number> = new Set();
  public multiSelectEnabled = false;
  private eventHandlerCBs!: {
    keyUp: (evt: KeyboardEvent) => void;
    keyDown: (evt: KeyboardEvent) => void;
    mouseUp: (evt: MouseEvent) => void;
  };
  private mouseUpCBs: (() => void)[] = [];

  constructor(
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    initialState: SerializedMIDIEditor2State
  ) {
    this.width = width;
    this.height = height;
    this.view = R.clone(initialState.view);

    this.app = new PIXI.Application({
      antialias: true,
      view: canvas,
      height,
      width,
      backgroundColor: conf.BACKGROUND_COLOR,
    });
    const interactionManager = this.app.renderer.plugins.interaction;
    interactionManager.cursorStyles['ew-resize'] = 'ew-resize';

    this.initEventHandlers();
    this.linesContainer = new PIXI.Container();
    this.app.stage.addChild(this.linesContainer);
    this.init(initialState);
  }

  private async init(initialState: SerializedMIDIEditor2State) {
    const wasmInst = await import('src/note_container');
    const noteLinesCtxPtr = wasmInst.create_note_lines(conf.LINE_COUNT);
    this.wasm = { instance: wasmInst, noteLinesCtxPtr };

    const lines: Note[][] = initialState.lines.map((notes, lineIx) => {
      return notes.map(note => {
        const id = wasmInst.create_note(noteLinesCtxPtr, lineIx, note.startPoint, note.length);
        return { ...note, id };
      });
    });
    this.lines = lines.map((notes, lineIx) => new NoteLine(this, notes, lineIx));
  }

  public pxToBeats(px: number) {
    return px / this.view.pxPerBeat;
  }

  public beatsToPx(beats: number) {
    return beats * this.view.pxPerBeat;
  }

  public addNote(lineIx: number, startPoint: number, length: number): number {
    if (!this.wasm) {
      throw new UnreachableException('Tried to create note before Wasm initialized');
    }
    const id = this.wasm.instance.create_note(
      this.wasm.noteLinesCtxPtr,
      lineIx,
      startPoint,
      length
    );
    const noteBox = new NoteBox(this.lines[lineIx], { id, startPoint, length });
    this.lines[lineIx].notesByID.set(id, noteBox);
    this.allNotesByID.set(id, noteBox);
    this.selectNote(id);
    return id;
  }

  public deleteNote(id: number) {
    this.selectedNoteIDs.delete(id);
    const note = this.allNotesByID.get(id);
    if (!note) {
      throw new UnreachableException(
        `Tried to delete note with id=${id} but it wasn't in the all notes map`
      );
    }
    if (!this.wasm) {
      throw new UnreachableException('Tried to delete note before wasm initialized');
    }
    this.wasm.instance.delete_note(
      this.wasm.noteLinesCtxPtr,
      note.line.index,
      note.note.startPoint,
      note.note.id
    );
    note.line.notesByID.delete(id);
    note.destroy();
  }

  public selectNote(id: number) {
    if (!this.multiSelectEnabled) {
      this.deselectAllNotes();
    }

    const note = this.allNotesByID.get(id);
    if (!note) {
      throw new UnreachableException(
        `Tried to select note id=${id} but no note in map with that id`
      );
    }
    note.setIsSelected(true);
    this.selectedNoteIDs.add(id);
  }

  public deselectNote(id: number) {
    const note = this.allNotesByID.get(id);
    if (!note) {
      throw new UnreachableException(
        `Tried to deselect note id=${id} but no note in map with that id`
      );
    }
    note.setIsSelected(false);
    const wasRemoved = this.selectedNoteIDs.delete(id);
    if (!wasRemoved) {
      console.warn(`Note id=${id} wasn't in the selected notes set when deselecting`);
    }
  }

  public deselectAllNotes() {
    for (const id of this.selectedNoteIDs) {
      this.deselectNote(id);
    }
  }

  public resizeNoteHorizontalStart(
    lineIx: number,
    startPoint: number,
    id: number,
    newStartPoint: number
  ) {
    const note = this.allNotesByID.get(id);
    if (!note) {
      throw new UnreachableException(
        `Tried to resize note id=${id} but not found in all notes mapping`
      );
    } else if (!this.wasm) {
      throw new UnreachableException('Tried to resize note before Wasm initialized');
    }

    // Prevent the note from being resized to be too small by forcing its length to remain above
    // the minimum note size by modifying the desired new start point
    const endPoint = note.note.startPoint + note.note.length;
    const newLengthPx = Math.max(
      this.beatsToPx(endPoint - newStartPoint),
      conf.MIN_DRAWING_NOTE_WIDTH_PX
    );
    const newLengthBeats = this.pxToBeats(newLengthPx);
    newStartPoint = endPoint - newLengthBeats;

    const realNewStartPoint = this.wasm.instance.resize_note_horizontal_start(
      this.wasm.noteLinesCtxPtr,
      lineIx,
      startPoint,
      id,
      newStartPoint
    );
    note.note.length += note.note.startPoint - realNewStartPoint;
    note.note.startPoint = realNewStartPoint;
    note.render();
    return realNewStartPoint;
  }

  public resizeNoteHorizontalEnd(
    lineIx: number,
    startPoint: number,
    id: number,
    newEndPoint: number
  ): number {
    const note = this.allNotesByID.get(id);
    if (!note) {
      throw new UnreachableException(
        `Tried to resize note id=${id} but not found in all notes mapping`
      );
    } else if (!this.wasm) {
      throw new UnreachableException('Tried to resize note before Wasm initialized');
    }

    // Prevent the note from being resized to be too small by forcing its length to remain above
    // the minimum note size by modifying the desired new end point
    const newLengthPx = Math.max(
      this.beatsToPx(newEndPoint - startPoint),
      conf.MIN_DRAWING_NOTE_WIDTH_PX
    );
    const newLengthBeats = this.pxToBeats(newLengthPx);
    newEndPoint = startPoint + newLengthBeats;

    const realNewEndPoint = this.wasm.instance.resize_note_horizontal_end(
      this.wasm.noteLinesCtxPtr,
      lineIx,
      startPoint,
      id,
      newEndPoint
    );
    note.note.length = realNewEndPoint - startPoint;
    note.render();
    return realNewEndPoint;
  }

  public serialize(): SerializedMIDIEditor2State {
    return {
      selectedNoteIDs: [...this.selectedNoteIDs],
      lines: this.lines.map(line =>
        [...line.notesByID.values()].map(note => ({
          startPoint: note.note.startPoint,
          length: note.note.length,
        }))
      ),
      view: this.view,
    };
  }

  private initEventHandlers() {
    this.eventHandlerCBs = {
      keyDown: (evt: KeyboardEvent) => {
        if (evt.key === 'Control') {
          this.multiSelectEnabled = true;
        } else if (evt.key === 'Delete') {
          for (const id of this.selectedNoteIDs) {
            this.deleteNote(id);
          }
          this.selectedNoteIDs.clear();
        }
        // TODO
      },
      keyUp: (evt: KeyboardEvent) => {
        if (evt.key === 'Control') {
          this.multiSelectEnabled = false;
        }
        // TODO
      },
      mouseUp: (_evt: MouseEvent) => {
        this.mouseUpCBs.forEach(cb => cb());
        this.mouseUpCBs = [];
      },
    };
    document.addEventListener('keydown', this.eventHandlerCBs.keyDown);
    document.addEventListener('keyup', this.eventHandlerCBs.keyUp);
    document.addEventListener('mouseup', this.eventHandlerCBs.mouseUp);
  }

  public addMouseUpCB(cb: () => void) {
    this.mouseUpCBs.push(cb);
  }

  private cleanupEventHandlers() {
    document.removeEventListener('keydown', this.eventHandlerCBs.keyDown);
    document.removeEventListener('keyup', this.eventHandlerCBs.keyUp);
    document.removeEventListener('mouseup', this.eventHandlerCBs.mouseUp);
  }

  public destroy() {
    this.cleanupEventHandlers();
    this.lines.forEach(line => line.destroy());
    this.app.stage.removeChild(this.linesContainer);
    this.linesContainer.destroy();
  }
}
