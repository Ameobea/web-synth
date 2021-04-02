import { UnreachableException } from 'ameo-utils';
import * as PIXI from 'pixi.js';
import * as R from 'ramda';

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

class SelectionBox {
  private app: MIDIEditor2Instance;
  private graphics: PIXI.Graphics;
  private startPoint: PIXI.Point;
  private endPoint: PIXI.Point;

  constructor(app: MIDIEditor2Instance, startPoint: PIXI.Point) {
    this.app = app;
    this.startPoint = startPoint;
    this.endPoint = startPoint;
    this.graphics = new PIXI.Graphics();
    this.app.linesContainer.addChild(this.graphics);
    this.update(startPoint);
  }

  public update(newEndPoint: PIXI.Point) {
    this.endPoint = newEndPoint;
    this.graphics.clear();
    const minX = Math.min(this.startPoint.x, this.endPoint.x);
    const maxX = Math.max(this.startPoint.x, this.endPoint.x);
    const minY = Math.min(this.startPoint.y, this.endPoint.y);
    const maxY = Math.max(this.startPoint.y, this.endPoint.y);
    this.graphics.lineStyle(1, conf.SELECTION_BOX_BORDER_COLOR);
    this.graphics.beginFill(conf.SELECTION_BOX_FILL_COLOR, 0.3);
    this.graphics.drawRect(minX, minY, maxX - minX, maxY - minY);
    this.graphics.endFill();

    const startLineIx = this.app.computeLineIndex(minY);
    const endLineIx = this.app.computeLineIndex(maxY);
    const startBeat = this.app.pxToBeats(minX) + this.app.view.scrollHorizontalBeats;
    const endBeat = this.app.pxToBeats(maxX) + this.app.view.scrollHorizontalBeats;
    const newSelectedNotes = new Set(
      this.app.wasm!.instance.iter_notes(
        this.app.wasm!.noteLinesCtxPtr,
        startLineIx,
        endLineIx,
        startBeat,
        endBeat
      )
    );
    for (const noteId of this.app.selectedNoteIDs.values()) {
      if (!newSelectedNotes.has(noteId)) {
        this.app.deselectNote(noteId);
      }
    }
    for (const noteId of newSelectedNotes.values()) {
      if (!this.app.selectedNoteIDs.has(noteId)) {
        this.app.selectNote(noteId);
      }
    }
  }

  public destroy() {
    this.app.linesContainer.removeChild(this.graphics);
    this.graphics.destroy();
  }
}

export interface SerializedMIDIEditor2State {
  lines: { startPoint: number; length: number }[][];
  view: MIDIEditorView;
  selectedNoteIDs: number[];
  beatSnapInterval: number;
}

enum NoteDragHandleSide {
  Left,
  Right,
}

class NoteDragHandle {
  private parentNote: NoteBox;
  private graphics: PIXI.Graphics;
  private side: NoteDragHandleSide;

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
    g.on('pointerdown', (evt: PIXI.InteractionEvent) => {
      if (evt.data.button !== 0 || this.parentNote.line.app.selectionBoxButtonDown) {
        return;
      }

      const isSelected = this.parentNote.line.app.selectedNoteIDs.has(this.parentNote.note.id);
      if (!isSelected) {
        this.parentNote.line.app.selectNote(this.parentNote.note.id);
      }

      this.parentNote.line.app.startResizingSelectedNotes(evt.data, this.side);
      evt.stopPropagation();
    });
    return g;
  }

  private computeWidth() {
    const noteWidth = this.parentNote.getWidthPx();
    if (noteWidth >= 20) {
      return 8;
    }

    return Math.max(Math.floor((noteWidth - 6) / 2), 3);
  }

  public handleDrag(downPos: PIXI.Point, newPos: PIXI.Point, originalPosBeats: number) {
    const diffPx = newPos.x - downPos.x;
    const diffBeats = this.parentNote.line.app.pxToBeats(diffPx);
    const newPosBeats = this.parentNote.line.app.snapBeat(originalPosBeats + diffBeats);
    const newLength =
      this.side === NoteDragHandleSide.Left
        ? this.parentNote.note.startPoint + this.parentNote.note.length - newPosBeats
        : newPosBeats - this.parentNote.note.startPoint;
    if (newLength <= 0) {
      return;
    }

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
  public leftDragHandle: NoteDragHandle;
  public rightDragHandle: NoteDragHandle;

  constructor(line: NoteLine, note: Note) {
    this.line = line;
    this.note = note;
    this.graphics = new PIXI.Graphics();
    this.graphics.interactive = true;
    this.graphics.cursor = 'pointer';
    this.graphics.on('pointerdown', (evt: PIXI.InteractionEvent) => {
      if ((evt.data.originalEvent as any).button !== 0) {
        return;
      }

      if (this.line.app.selectedNoteIDs.has(this.note.id)) {
        if (this.line.app.multiSelectEnabled) {
          this.line.app.deselectNote(this.note.id);
        }
      } else {
        this.line.app.selectNote(this.note.id);
      }

      this.line.app.startDraggingSelectedNotes(evt.data);
    });

    this.leftDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Left);
    this.rightDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Right);

    this.render();
  }

  public render() {
    const width = this.note.length * this.line.app.view.pxPerBeat;
    // this.graphics.width = width;
    // console.log({})
    this.graphics.clear();
    this.graphics.lineStyle(1, 0x333333);
    this.graphics.beginFill(this.isSelected ? conf.NOTE_SELECTED_COLOR : conf.NOTE_COLOR);
    this.graphics.drawRect(1, 0, width, conf.LINE_HEIGHT - 1);
    this.graphics.endFill();
    this.graphics.x =
      (this.note.startPoint - this.line.app.view.scrollHorizontalBeats) *
      this.line.app.view.pxPerBeat;

    this.line.container.addChild(this.graphics);

    this.leftDragHandle.render();
    this.rightDragHandle.render();
  }

  public handleDrag(newDesiredStartPos: number) {
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
  private graphics: PIXI.Graphics;
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
    this.container.y = index * conf.LINE_HEIGHT - this.app.view.scrollVerticalPx;
    this.graphics = new PIXI.Graphics();
    this.renderMarkers();
    this.container.addChild(this.graphics);
    notes.forEach(note => {
      const noteBox = new NoteBox(this, note);
      this.app.allNotesByID.set(note.id, noteBox);
      this.notesByID.set(note.id, noteBox);
    });
    this.app.linesContainer.addChild(this.container);
    this.installNoteCreationHandlers();
  }

  private installNoteCreationHandlers() {
    this.background
      .on('pointerdown', (evt: any) => {
        if (evt.data.button !== 0 || this.app.selectionBoxButtonDown) {
          return;
        }

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
        const newPosBeats = this.app.snapBeat(
          this.app.pxToBeats(data.getLocalPosition(this.background).x)
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
    this.container.y = this.index * conf.LINE_HEIGHT - this.app.view.scrollVerticalPx;
    this.renderMarkers();
    for (const note of this.notesByID.values()) {
      note.render();
    }
  }

  private renderMarkers() {
    this.graphics.clear();

    // bottom border
    this.graphics.lineStyle(1, conf.LINE_BORDER_COLOR);
    this.graphics.moveTo(0, conf.LINE_HEIGHT);
    this.graphics.lineTo(this.app.width, conf.LINE_HEIGHT);

    let beat = Math.ceil(this.app.view.scrollHorizontalBeats);
    const visibleBeats = this.app.width / this.app.view.pxPerBeat;
    const endBeat = Math.floor(this.app.view.scrollHorizontalBeats + visibleBeats);
    while (beat <= endBeat) {
      const isMeasureLine = beat % this.app.view.beatsPerMeasure === 0;
      let x = this.app.beatsToPx(beat - this.app.view.scrollHorizontalBeats);
      if (isMeasureLine) {
        // We want the measure lines to be crisp, so we ensure that they're exactly 1 pixel wide
        // https://github.com/pixijs/pixi.js/issues/4328
        x = Math.round(x) - 0.5;
        this.graphics.lineStyle(1, conf.MEASURE_LINE_COLOR);
        this.graphics.moveTo(x, 0);
        this.graphics.lineTo(x, conf.LINE_HEIGHT - 0);
      } else {
        this.graphics.lineStyle(0.8, conf.NOTE_MARK_COLOR);
        this.graphics.moveTo(x, conf.LINE_HEIGHT * 0.87);
        this.graphics.lineTo(x, conf.LINE_HEIGHT);
      }
      beat += 1;
    }
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
    wheel: (evt: WheelEvent) => void;
  };
  private mouseUpCBs: (() => void)[] = [];
  private panningData: { startPoint: PIXI.Point; startView: MIDIEditorView } | null = null;
  private resizeData: {
    globalStartPoint: PIXI.Point;
    side: NoteDragHandleSide;
    originalPosBeatsByNoteId: Map<number, number>;
  } | null = null;
  private dragData: {
    globalStartPoint: PIXI.Point;
    originalPosBeatsByNoteId: Map<number, number>;
    startLineIx: number;
  } | null = null;
  private selectionBox: SelectionBox | null = null;
  public selectionBoxButtonDown = false;
  private beatSnapInterval: number;

  constructor(
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    initialState: SerializedMIDIEditor2State
  ) {
    this.width = width;
    this.height = height;
    this.view = R.clone(initialState.view);
    this.beatSnapInterval = initialState.beatSnapInterval;

    this.app = new PIXI.Application({
      antialias: true,
      view: canvas,
      height,
      width,
      backgroundColor: conf.BACKGROUND_COLOR,
    });
    const interactionManager: PIXI.InteractionManager = this.app.renderer.plugins.interaction;
    interactionManager.cursorStyles['ew-resize'] = 'ew-resize';

    this.initEventHandlers();
    this.linesContainer = new PIXI.Container();
    this.linesContainer.interactive = true;
    this.linesContainer.cursor = 'default';
    this.linesContainer
      .on('pointerdown', (evt: PIXI.InteractionEvent) => {
        if (evt.data.button === 0) {
          if (this.selectionBoxButtonDown && !this.selectionBox) {
            this.selectionBox = new SelectionBox(
              this,
              evt.data.getLocalPosition(this.linesContainer)
            );
          }
        } else if (evt.data.button === 1) {
          this.startPanning(evt.data);
        }
      })
      .on('pointermove', (evt: PIXI.InteractionEvent) => {
        this.handlePan(evt.data);
        this.handleResize(evt.data);
        this.handleDrag(evt.data);
        if (this.selectionBox) {
          this.selectionBox.update(evt.data.getLocalPosition(this.linesContainer));
        }
      });
    this.app.stage.addChild(this.linesContainer);
    this.init(initialState);
  }

  private async init(initialState: SerializedMIDIEditor2State) {
    const wasmInst = await import('src/note_container');
    const noteLinesCtxPtr = wasmInst.create_note_lines(conf.LINE_COUNT);
    this.wasm = { instance: wasmInst, noteLinesCtxPtr };

    const lines: Note[][] = initialState.lines.map((notes, lineIx) => {
      return notes.map(note => {
        const id = wasmInst.create_note(noteLinesCtxPtr, lineIx, note.startPoint, note.length, 0);
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

  public snapBeat(rawBeat: number): number {
    if (this.beatSnapInterval === 0) {
      return rawBeat;
    }

    return Math.round(rawBeat * (1 / this.beatSnapInterval)) / (1 / this.beatSnapInterval);
  }

  public addNote(lineIx: number, startPoint: number, length: number): number {
    if (!this.wasm) {
      throw new UnreachableException('Tried to create note before Wasm initialized');
    }
    const id = this.wasm.instance.create_note(
      this.wasm.noteLinesCtxPtr,
      lineIx,
      startPoint,
      length,
      0
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
    if (!this.multiSelectEnabled && !this.selectionBoxButtonDown) {
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

  private startPanning(data: PIXI.InteractionData) {
    this.panningData = {
      startPoint: data.getLocalPosition(this.linesContainer),
      startView: R.clone(this.view),
    };
  }

  private handlePan(data: PIXI.InteractionData) {
    if (!this.panningData) {
      return;
    }
    const newPoint = data.getLocalPosition(this.linesContainer);
    const xDiffPx = -(newPoint.x - this.panningData.startPoint.x);
    const yDiffPx = -(newPoint.y - this.panningData.startPoint.y);

    this.view.scrollHorizontalBeats = Math.max(
      this.panningData.startView.scrollHorizontalBeats + this.pxToBeats(xDiffPx),
      0
    );
    this.view.scrollVerticalPx = Math.max(this.panningData.startView.scrollVerticalPx + yDiffPx, 0);
    this.handleViewChange();
  }

  private stopPanning() {
    this.panningData = null;
  }

  public startResizingSelectedNotes(data: PIXI.InteractionData, side: NoteDragHandleSide) {
    this.resizeData = {
      globalStartPoint: data.global.clone(),
      side,
      originalPosBeatsByNoteId: new Map(),
    };
    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableException(
          `Note id ${noteId} is selected but is not in the global mapping`
        );
      }

      const originalPosBeats =
        side === NoteDragHandleSide.Left
          ? note.note.startPoint
          : note.note.startPoint + note.note.length;
      this.resizeData.originalPosBeatsByNoteId.set(noteId, originalPosBeats);
    }
  }

  private handleResize(data: PIXI.InteractionData) {
    if (!this.resizeData) {
      return;
    }

    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableException(
          `Note id ${noteId} is selected but is not in the global mapping`
        );
      }

      const handle =
        this.resizeData.side === NoteDragHandleSide.Left
          ? note.leftDragHandle
          : note.rightDragHandle;
      const originalPosBeats = this.resizeData.originalPosBeatsByNoteId.get(noteId);
      if (R.isNil(originalPosBeats)) {
        throw new UnreachableException(`No original pos beats recorded for note id ${noteId}`);
      }
      handle.handleDrag(this.resizeData.globalStartPoint, data.global, originalPosBeats);
    }
  }

  public computeLineIndex(localY: number) {
    const adjustedY = localY + this.view.scrollVerticalPx;
    return Math.floor(adjustedY / conf.LINE_HEIGHT);
  }

  public startDraggingSelectedNotes(data: PIXI.InteractionData) {
    const localY = data.getLocalPosition(this.linesContainer).y;
    this.dragData = {
      globalStartPoint: data.global.clone(),
      originalPosBeatsByNoteId: new Map(),
      startLineIx: this.computeLineIndex(localY),
    };

    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableException(
          `Note id ${noteId} is selected but is not in the global mapping`
        );
      }

      const originalPosBeats = note.note.startPoint;
      this.dragData.originalPosBeatsByNoteId.set(noteId, originalPosBeats);
    }
  }

  public handleDrag(data: PIXI.InteractionData) {
    if (!this.dragData) {
      return;
    }

    const xDiffPx = data.global.x - this.dragData.globalStartPoint.x;
    const xDiffBeats = this.pxToBeats(xDiffPx);

    // We first move all of the notes horizontally before attempting any vertical movement
    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableException(`Note id ${noteId} is selected but not in global mapping`);
      }

      const originalPosBeats = this.dragData.originalPosBeatsByNoteId.get(noteId);
      if (R.isNil(originalPosBeats)) {
        throw new UnreachableException(
          `Note id ${noteId} is selected but not in original pos mapping`
        );
      }
      const newDesiredStartPosBeats = Math.max(this.snapBeat(originalPosBeats + xDiffBeats), 0);
      note.handleDrag(newDesiredStartPosBeats);
    }

    const newStartLineIndex = this.computeLineIndex(data.getLocalPosition(this.linesContainer).y);
    const lineDiff = newStartLineIndex - this.dragData.startLineIx;
    if (lineDiff === 0) {
      return;
    }

    // We check to see if *all* of the selected notes can successfully be moved to their new vertical positions
    // and only move them if there are no conflicts.
    if (!this.wasm) {
      throw new UnreachableException('Tried to drag notes before wasm initialized');
    }
    const allSelectedNotes: NoteBox[] = [];
    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId)!;
      allSelectedNotes.push(note);

      const newLineIndex = note.line.index + lineDiff;
      if (newLineIndex < 0 || newLineIndex >= this.lines.length) {
        return;
      }

      const canMove = this.wasm.instance.check_can_add_note(
        this.wasm.noteLinesCtxPtr,
        newLineIndex,
        note.note.startPoint,
        note.note.length
      );
      if (!canMove) {
        return;
      }
    }
    this.dragData.startLineIx = newStartLineIndex;

    // No conflicts, we can move all of them!  However, we need to make sure that we move them in order of
    // line index to ensure we don't move them into each other.
    allSelectedNotes.sort((a, b) => {
      // Return a negative number if first argument is less than second argument
      const diff = a.line.index - b.line.index;
      return diff * (lineDiff > 0 ? -1 : 1);
    });
    allSelectedNotes.forEach(note => {
      this.moveNoteToLine(note, note.line.index + lineDiff);
    });
  }

  private moveNoteToLine(note: NoteBox, newLineIx: number) {
    note.line.container.removeChild(note.graphics);
    note.line.notesByID.delete(note.note.id);
    this.wasm!.instance.delete_note(
      this.wasm!.noteLinesCtxPtr,
      note.line.index,
      note.note.startPoint,
      note.note.id
    );
    this.wasm!.instance.create_note(
      this.wasm!.noteLinesCtxPtr,
      newLineIx,
      note.note.startPoint,
      note.note.length,
      note.note.id
    );
    note.line = this.lines[newLineIx];
    note.line.container.addChild(note.graphics);
    note.line.notesByID.set(note.note.id, note);
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
      beatSnapInterval: this.beatSnapInterval,
    };
  }

  private handleViewChange() {
    this.lines.forEach(line => line.handleViewChange());
  }

  private handleZoom(deltaYPx: number) {
    const multiplier = Math.pow(2, -deltaYPx / conf.SCROLL_ZOOM_DOUBLE_INTERVAL_PX);
    this.view.pxPerBeat = Math.max(this.view.pxPerBeat * multiplier, 1);
    this.handleViewChange();
  }

  private initEventHandlers() {
    this.eventHandlerCBs = {
      keyDown: (evt: KeyboardEvent) => {
        if (evt.key === 'Control') {
          this.multiSelectEnabled = true;
        } else if (evt.key === 'Shift') {
          this.selectionBoxButtonDown = true;
        } else if (evt.key === 'Delete') {
          for (const id of this.selectedNoteIDs) {
            this.deleteNote(id);
          }
          this.selectedNoteIDs.clear();
        }
      },
      keyUp: (evt: KeyboardEvent) => {
        if (evt.key === 'Control') {
          this.multiSelectEnabled = false;
        } else if (evt.key === 'Shift') {
          this.selectionBoxButtonDown = false;
        }
      },
      mouseUp: (evt: MouseEvent) => {
        if (evt.button === 0) {
          this.mouseUpCBs.forEach(cb => cb());
          this.mouseUpCBs = [];

          this.resizeData = null;
          this.dragData = null;

          if (this.selectionBox) {
            this.selectionBox.destroy();
            this.selectionBox = null;
          }
        } else if (evt.button === 1) {
          this.stopPanning();
        }
      },
      wheel: (evt: WheelEvent) => {
        if (evt.target !== this.app.renderer.view || this.panningData) {
          return;
        }

        this.handleZoom(evt.deltaY);
        evt.preventDefault();
        evt.stopPropagation();
      },
    };
    document.addEventListener('keydown', this.eventHandlerCBs.keyDown);
    document.addEventListener('keyup', this.eventHandlerCBs.keyUp);
    document.addEventListener('mouseup', this.eventHandlerCBs.mouseUp);
    document.addEventListener('wheel', this.eventHandlerCBs.wheel, { passive: false });
  }

  public addMouseUpCB(cb: () => void) {
    this.mouseUpCBs.push(cb);
  }

  private cleanupEventHandlers() {
    document.removeEventListener('keydown', this.eventHandlerCBs.keyDown);
    document.removeEventListener('keyup', this.eventHandlerCBs.keyUp);
    document.removeEventListener('mouseup', this.eventHandlerCBs.mouseUp);
    document.removeEventListener('wheel', this.eventHandlerCBs.wheel);
  }

  public destroy() {
    this.cleanupEventHandlers();
    this.lines.forEach(line => line.destroy());
    this.app.stage.removeChild(this.linesContainer);
    this.linesContainer.destroy();
  }
}
