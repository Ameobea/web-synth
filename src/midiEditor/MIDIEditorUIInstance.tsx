import { UnreachableException } from 'ameo-utils';
import { Option } from 'funfix-core';
import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import type { MIDIEditorInstance } from 'src/midiEditor';
import { Cursor, CursorGutter, LoopCursor } from 'src/midiEditor/Cursor';
import type { NoteBox } from 'src/midiEditor/NoteBox';
import MIDINoteBox, {
  NoteDragHandle,
  NoteDragHandleSide,
} from 'src/midiEditor/NoteBox/MIDINoteBox';
import NoteLine from 'src/midiEditor/NoteLine';
import PianoKeys from 'src/midiEditor/PianoKeyboard';
import SelectionBox from 'src/midiEditor/SelectionBox';
import {
  getIsVcHidden,
  registerVcHideCb,
  unregisterVcHideCb,
} from 'src/ViewContextManager/VcHideStatusRegistry';
import * as conf from './conf';

export interface Note {
  id: number;
  startPoint: number;
  /**
   * Length of the note in beats
   */
  length: number;
}

PIXI.utils.skipHello();

export interface MIDIEditorView {
  /**
   * Zoom factor, indicating how many pixels per beat are rendered.
   */
  pxPerBeat: number;
  scrollHorizontalBeats: number;
  scrollVerticalPx: number;
  beatsPerMeasure: number;
}

export interface SerializedMIDIEditorState {
  lines: { midiNumber: number; notes: { startPoint: number; length: number }[] }[];
  view: MIDIEditorView;
  beatSnapInterval: number;
  cursorPosBeats: number;
  localBPM: number;
  loopPoint: number | null;
  metronomeEnabled: boolean;
}

export default class MIDIEditorUIInstance {
  public width: number;
  public height: number;
  public parentInstance: MIDIEditorInstance;
  public app: PIXI.Application;
  public wasm:
    | {
        instance: typeof import('src/note_container');
        noteLinesCtxPtr: number;
      }
    | undefined;
  public linesContainer: PIXI.Container;
  public lines: NoteLine[] = [];
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
    dragHandlesByNoteID: Map<number, NoteDragHandle>;
  } | null = null;
  private dragData: {
    globalStartPoint: PIXI.Point;
    originalPosBeatsByNoteId: Map<number, number>;
    startLineIx: number;
  } | null = null;
  private selectionBox: SelectionBox | null = null;
  public selectionBoxButtonDown = false;
  private beatSnapInterval: number;
  public cursor: Cursor;
  private pianoKeys: PianoKeys | undefined;
  public localBPM: number;
  public loopCursor: LoopCursor | null;
  private clipboard: { startPoint: number; length: number; lineIx: number }[] = [];
  public noteMetadataByNoteID: Map<number, any> = new Map();
  private vcId: string;
  private isHidden: boolean;
  private destroyed = false;

  constructor(
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    initialState: SerializedMIDIEditorState,
    parentInstance: MIDIEditorInstance,
    vcId: string
  ) {
    this.width = width;
    this.height = height;
    this.view = R.clone(initialState.view);
    this.beatSnapInterval = initialState.beatSnapInterval;
    this.localBPM = initialState.localBPM ?? 120;
    this.loopCursor = Option.of(initialState.loopPoint)
      .map(loopPoint => new LoopCursor(this, loopPoint))
      .orNull();
    this.parentInstance = parentInstance;
    this.vcId = vcId;

    this.app = new PIXI.Application({
      antialias: true,
      resolution: 2,
      autoDensity: true,
      view: canvas,
      height,
      width,
      backgroundColor: conf.BACKGROUND_COLOR,
    });
    const interactionManager: PIXI.InteractionManager = this.app.renderer.plugins.interaction;
    interactionManager.cursorStyles['ew-resize'] = 'ew-resize';

    registerVcHideCb(this.vcId, this.onHiddenStatusChanged);
    this.isHidden = getIsVcHidden(this.vcId);
    this.onHiddenStatusChanged(this.isHidden);

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

    this.linesContainer.x = conf.PIANO_KEYBOARD_WIDTH;
    this.linesContainer.y = conf.CURSOR_GUTTER_HEIGHT;
    // Clip stuff hidden at the top outside of it
    this.linesContainer.mask = new PIXI.Graphics()
      .beginFill(0xff3300)
      .drawRect(
        conf.PIANO_KEYBOARD_WIDTH,
        10,
        this.width - conf.PIANO_KEYBOARD_WIDTH - 10,
        this.height - 20
      )
      .endFill();
    this.app.stage.addChild(this.linesContainer);

    // Cursor gutter
    const cursorGutter = new CursorGutter(this);

    this.cursor = new Cursor(this);
    this.cursor.setPosBeats(initialState.cursorPosBeats ?? 0);
    this.app.ticker.add(() => {
      this.cursor.setPosBeats(this.parentInstance.getCursorPosBeats());
      this.parentInstance.playbackHandler?.recordingCtx?.tick();
    });

    this.init(initialState).then(() => {
      if (this.destroyed) {
        return;
      }
      this.pianoKeys = new PianoKeys(this);

      // border around everything
      this.app.stage.addChild(
        new PIXI.Graphics()
          .lineStyle(1, conf.LINE_BORDER_COLOR)
          .moveTo(conf.PIANO_KEYBOARD_WIDTH, conf.CURSOR_GUTTER_HEIGHT)
          .lineTo(this.width - 10.5, conf.CURSOR_GUTTER_HEIGHT)
          .lineTo(this.width - 10.5, this.height - 10.5)
          .lineTo(conf.PIANO_KEYBOARD_WIDTH, this.height - 10.5)
          .lineTo(conf.PIANO_KEYBOARD_WIDTH, conf.CURSOR_GUTTER_HEIGHT)
      );

      this.app.stage.addChild(this.cursor.graphics);
      if (this.loopCursor) {
        this.app.stage.addChild(this.loopCursor.graphics);
      }
    });
  }

  private buildNoteLines(
    serializedLines: {
      midiNumber: number;
      notes: {
        startPoint: number;
        length: number;
      }[];
    }[]
  ) {
    const lines: Note[][] = new Array(serializedLines.length).fill(null).map(() => []);
    serializedLines.forEach(({ midiNumber, notes }) => {
      const lineIx = lines.length - midiNumber;
      if (lineIx >= lines.length) {
        console.error(`Tried to load line for MIDI number ${midiNumber} which is out of range`);
        return;
      }

      lines[lineIx] = notes.map(note => {
        const id = this.wasm!.instance.create_note(
          this.wasm!.noteLinesCtxPtr,
          lineIx,
          note.startPoint,
          note.length,
          0
        );
        return { ...note, id };
      });
    });
    return lines.map((notes, lineIx) => new NoteLine(this, notes, lineIx));
  }

  private async init(initialState: SerializedMIDIEditorState) {
    const wasmInst = await import('src/note_container');
    const noteLinesCtxPtr = wasmInst.create_note_lines(initialState.lines.length);
    this.wasm = { instance: wasmInst, noteLinesCtxPtr };
    if (this.destroyed) {
      return;
    }

    this.lines = this.buildNoteLines(initialState.lines);
  }

  public async reInitialize(newState: SerializedMIDIEditorState) {
    if (!this.wasm) {
      console.error('Tried to re-initialize MIDI editor state before Wasm initialized');
      return;
    }

    // Delete all existing notes
    for (const noteID of this.allNotesByID.keys()) {
      this.deleteNote(noteID);
    }

    this.lines.forEach(line => line.destroy());
    this.wasm.instance.set_line_count(this.wasm.noteLinesCtxPtr, newState.lines.length);
    this.lines = this.buildNoteLines(newState.lines);

    // Destroy + re-create piano notes
    this.pianoKeys?.destroy();
    this.pianoKeys = new PianoKeys(this);

    // Adjust the view to match
    this.view.beatsPerMeasure = newState.view.beatsPerMeasure;
    this.view.pxPerBeat = newState.view.pxPerBeat;
    this.view.scrollHorizontalBeats = newState.view.scrollHorizontalBeats;
    this.view.scrollVerticalPx = newState.view.scrollVerticalPx;
    this.handleViewChange();

    // Set other misc. state
    this.setBeatSnapInterval(newState.beatSnapInterval);
    this.localBPM = newState.localBPM;
    this.toggleLoop(newState.loopPoint);
    this.cursor.setPosBeats(newState.cursorPosBeats);
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

  public setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);
    this.handleViewChange();
  }

  /**
   * @returns ID of the created note
   */
  public addNote(
    lineIx: number,
    startPoint: number,
    length: number,
    NoteBoxClass: typeof NoteBox = MIDINoteBox
  ): number {
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
    const noteBox = new NoteBoxClass(this.lines[lineIx], { id, startPoint, length });
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
    this.allNotesByID.delete(id);
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

  /**
   * @returns the actual new endpoint of the note after requesting resize
   */
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
    const maxVerticalScrollPx = Math.max(
      this.lines.length * conf.LINE_HEIGHT - this.height + conf.CURSOR_GUTTER_HEIGHT + 10,
      0
    );
    this.view.scrollVerticalPx = R.clamp(
      0,
      maxVerticalScrollPx,
      this.panningData.startView.scrollVerticalPx + yDiffPx
    );
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
      dragHandlesByNoteID: new Map(),
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
      const specializedNote = (() => {
        if (note instanceof MIDINoteBox) {
          return note as MIDINoteBox;
        }
        throw new UnreachableException("Cannot resize notes that don't have drag handles");
      })();
      this.resizeData.dragHandlesByNoteID.set(
        noteId,
        side === NoteDragHandleSide.Left
          ? specializedNote.leftDragHandle
          : specializedNote.rightDragHandle
      );
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
      const handle = this.resizeData.dragHandlesByNoteID.get(noteId)!;

      const originalPosBeats = this.resizeData.originalPosBeatsByNoteId.get(noteId);
      if (R.isNil(originalPosBeats)) {
        throw new UnreachableException(`No original pos beats recorded for note id ${noteId}`);
      }
      handle.handleDrag(this.resizeData.globalStartPoint, data.global, originalPosBeats);
    }
  }

  public copySelection() {
    this.clipboard = [];
    for (const noteID of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteID)!;
      this.clipboard.push({
        lineIx: note.line.index,
        startPoint: note.note.startPoint,
        length: note.note.length,
      });
    }
  }

  public cutSelection() {
    this.copySelection();
    // Delete all selected notes since we're cutting
    for (const noteID of this.selectedNoteIDs.keys()) {
      this.deleteNote(noteID);
    }
  }

  public pasteSelection() {
    if (R.isEmpty(this.clipboard) || !this.wasm) {
      return;
    }
    const wasm = this.wasm;

    const cursorPosBeats = this.parentInstance.playbackHandler.getCursorPosBeats();
    const startBeat = Math.min(...this.clipboard.map(R.prop('startPoint')));
    const endBeat = Math.max(...this.clipboard.map(note => note.startPoint + note.length));

    // First we deselect all selected notes since we'll be selecting all pasted notes after creating them
    this.deselectAllNotes();

    const createdNoteIDs: number[] = [];
    // Then we create + select all notes
    this.clipboard.forEach(note => {
      const normalizedStartPoint = note.startPoint - startBeat + cursorPosBeats;
      const canCreate = wasm.instance.check_can_add_note(
        wasm.noteLinesCtxPtr,
        note.lineIx,
        normalizedStartPoint,
        note.length
      );
      if (!canCreate) {
        return;
      }

      const id = this.addNote(note.lineIx, normalizedStartPoint, note.length);
      createdNoteIDs.push(id);
    });

    this.deselectAllNotes();
    createdNoteIDs.forEach(id => this.selectNote(id));
    const normalizedEndBeat = endBeat - startBeat + cursorPosBeats;
    this.parentInstance.playbackHandler.setCursorPosBeats(normalizedEndBeat);
  }

  /**
   * Quantizes all notes' start and end points to the nearest `beatSnapInterval`, handling conflicts and
   * performing some other special-case operations.  See https://synth.ameo.dev/docs/2021-04-18
   * for design, algorithm, and implementation details.
   */
  public snapAllSelectedNotes() {
    if (this.beatSnapInterval === 0) {
      return;
    }
    const wasm = this.wasm;
    if (!wasm) {
      return;
    }
    const selectedNotesByLineIx: Map<number, NoteBox[]> = new Map();

    // Step 1: Perform all operations that shorten notes since those are guarenteed to be conflict-free.
    for (const noteID of this.selectedNoteIDs.values()) {
      const noteBox = this.allNotesByID.get(noteID)!;
      const { note, line } = noteBox;

      let entries = selectedNotesByLineIx.get(line.index);
      if (!entries) {
        entries = [];
        selectedNotesByLineIx.set(line.index, entries);
      }
      entries.push(noteBox);

      // Ignore notes that are < half the beat snap interval for now since they need special handling
      if (note.length <= this.beatSnapInterval / 2) {
        continue;
      }

      const snappedStart = this.snapBeat(note.startPoint);
      const snappedEnd = this.snapBeat(note.startPoint + note.length);

      if (snappedStart > note.startPoint) {
        this.resizeNoteHorizontalStart(line.index, note.startPoint, note.id, snappedStart);
      }

      if (snappedEnd < note.startPoint + note.length) {
        this.resizeNoteHorizontalEnd(line.index, note.startPoint, note.id, snappedEnd);
      }
    }

    // Step 2: Move all small notes that are < half the beat snap interval where possible, leaving the in
    // place in case of conflicts.  We do not change their lengths to avoid them collapsing into zero length.
    for (const [lineIx, notes] of selectedNotesByLineIx.entries()) {
      // Sort the notes to make them in order by start beat
      notes.sort((note1, note2) => note1.note.startPoint - note2.note.startPoint);

      const shortNotes = notes.filter(({ note }) => note.length <= this.beatSnapInterval / 2);
      shortNotes.forEach(({ note }) => {
        wasm.instance.delete_note(wasm.noteLinesCtxPtr, lineIx, note.startPoint, note.id);
        const snappedStart = this.snapBeat(note.startPoint);
        const canMove = wasm.instance.check_can_add_note(
          wasm.noteLinesCtxPtr,
          lineIx,
          snappedStart,
          note.length
        );

        if (!canMove) {
          // Re-insert the note where it was before in case of conflict
          wasm.instance.create_note(
            wasm.noteLinesCtxPtr,
            lineIx,
            note.startPoint,
            note.length,
            note.id
          );
          return;
        }

        // We're good to move the note, so re-insert at the snapped start point
        note.startPoint = snappedStart;
        wasm.instance.create_note(wasm.noteLinesCtxPtr, lineIx, snappedStart, note.length, note.id);
      });
    }

    // Now, we extend notes wherever possible, falling back to leaving them as-is in case of any conflict
    for (const noteID of this.selectedNoteIDs.values()) {
      const noteBox = this.allNotesByID.get(noteID)!;
      const { note, line } = noteBox;

      // Ignore notes that are < half the beat snap interval since we've already handled them
      if (note.length <= this.beatSnapInterval / 2) {
        continue;
      }

      const snappedStart = this.snapBeat(note.startPoint);
      const snappedEnd = this.snapBeat(note.startPoint + note.length);

      if (snappedStart < note.startPoint) {
        wasm.instance.delete_note(wasm.noteLinesCtxPtr, line.index, note.startPoint, note.id);
        const canMove = wasm.instance.check_can_add_note(
          wasm.noteLinesCtxPtr,
          line.index,
          snappedStart,
          note.length
        );

        if (!canMove) {
          // Re-insert the note where it was before in case of conflict
          wasm.instance.create_note(
            wasm.noteLinesCtxPtr,
            line.index,
            note.startPoint,
            note.length,
            note.id
          );
        } else {
          note.length += snappedStart - note.startPoint;
          note.startPoint = snappedStart;
          wasm.instance.create_note(
            wasm.noteLinesCtxPtr,
            line.index,
            note.startPoint,
            note.length,
            note.id
          );
        }
      }

      if (snappedEnd > note.startPoint + note.length) {
        wasm.instance.delete_note(wasm.noteLinesCtxPtr, line.index, note.startPoint, note.id);
        const newLength = note.length + (snappedEnd - (note.startPoint + note.length));
        const canMove = wasm.instance.check_can_add_note(
          wasm.noteLinesCtxPtr,
          line.index,
          note.startPoint,
          newLength
        );

        if (!canMove) {
          // Re-insert the note where it was before in case of conflict
          wasm.instance.create_note(
            wasm.noteLinesCtxPtr,
            line.index,
            note.startPoint,
            note.length,
            note.id
          );
        } else {
          note.length = newLength;
          wasm.instance.create_note(
            wasm.noteLinesCtxPtr,
            line.index,
            note.startPoint,
            note.length,
            note.id
          );
        }
      }
    }

    // Since we manually updated note lengths, re-render everything
    this.handleViewChange();
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

  public gate(lineIx: number) {
    this.parentInstance.gate(lineIx);
    this.pianoKeys?.setNotePlaying(lineIx, true);
  }

  public onGated(lineIx: number) {
    this.pianoKeys?.setNotePlaying(lineIx, true);
  }

  public onUngated(lineIx: number) {
    this.pianoKeys?.setNotePlaying(lineIx, false);
  }

  public ungate(lineIx: number) {
    this.parentInstance.ungate(lineIx);
    this.pianoKeys?.setNotePlaying(lineIx, false);
  }

  public gateAllSelectedNotes() {
    const allGatedLineIndices = new Set(
      [...this.selectedNoteIDs].map(noteId => this.allNotesByID.get(noteId)!.line.index)
    );
    for (const lineIx of allGatedLineIndices) {
      this.gate(lineIx);
    }
  }

  public ungateAllSelectedNotes() {
    const allGatedLineIndices = new Set(
      [...this.selectedNoteIDs].map(noteId => this.allNotesByID.get(noteId)!.line.index)
    );
    for (const lineIx of allGatedLineIndices) {
      this.ungate(lineIx);
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
    const ungatedLineIndices: Set<number> = new Set();
    const gatedLineIndices: Set<number> = new Set();
    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId)!;
      allSelectedNotes.push(note);

      ungatedLineIndices.add(note.line.index);
      const newLineIndex = note.line.index + lineDiff;
      gatedLineIndices.add(newLineIndex);
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

    for (const lineIx of ungatedLineIndices) {
      this.ungate(lineIx);
    }
    for (const lineIx of gatedLineIndices) {
      this.gate(lineIx);
    }

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

  public toggleLoop(loopPoint?: number | null | undefined) {
    if (this.parentInstance.playbackHandler.isPlaying) {
      return;
    }

    if (this.loopCursor) {
      this.app.stage.removeChild(this.loopCursor.graphics);
      this.loopCursor.destroy();
      this.loopCursor = null;
      this.parentInstance.playbackHandler.setLoopPoint(null);
    } else {
      const newLoopPoint = this.snapBeat(
        loopPoint ?? this.parentInstance.getCursorPosBeats() + this.view.beatsPerMeasure
      );
      this.parentInstance.playbackHandler.setLoopPoint(newLoopPoint);
      this.loopCursor = new LoopCursor(this, newLoopPoint);
      this.app.stage.addChild(this.loopCursor.graphics);
    }
  }

  public setBeatSnapInterval(newBeatSnapInterval: number) {
    this.beatSnapInterval = newBeatSnapInterval;
  }

  public serialize(): SerializedMIDIEditorState {
    return {
      lines: this.lines.map((line, lineIx) => ({
        midiNumber: this.lines.length - lineIx,
        notes: [...line.notesByID.values()].map(note => ({
          startPoint: note.note.startPoint,
          length: note.note.length,
        })),
      })),
      view: R.clone(this.view),
      beatSnapInterval: this.beatSnapInterval,
      cursorPosBeats: this.parentInstance.getCursorPosBeats(),
      localBPM: this.localBPM,
      loopPoint: this.loopCursor?.getPosBeats() ?? null,
      metronomeEnabled: this.parentInstance.playbackHandler.metronomeEnabled,
    };
  }

  /**
   * Encodes all notes into a buffer representing `RawNoteData` structs from the `common` Wasm crate.
   *
   * This is passed into Wasm and used export MIDI files.
   */
  public exportToRawNoteDataBuffer(): Uint8Array {
    const totalNoteCount = this.allNotesByID.size;
    const rawNoteSizeBytes = 4 + 8 + 8 + 4; // note number, start_beat, length, padding
    const buffer = new Uint8Array(rawNoteSizeBytes * totalNoteCount);
    const u32View = new Uint32Array(buffer.buffer);
    const f64View = new Float64Array(buffer.buffer);

    let entryCount = 0;
    this.lines.forEach((line, lineIx) => {
      for (const note of line.notesByID.values()) {
        const u32BufferOffset = entryCount * 6;
        const midiNumber = this.lines.length - lineIx;
        u32View[u32BufferOffset] = midiNumber;

        const f64BufferOffset = entryCount * 3;
        f64View[f64BufferOffset + 1] = note.note.startPoint;
        f64View[f64BufferOffset + 2] = note.note.length;

        entryCount += 1;
      }
    });

    return buffer;
  }

  private handleViewChange() {
    this.lines.forEach(line => line.handleViewChange());
    this.cursor.handleViewChange();
    this.loopCursor?.handleViewChange();
    this.pianoKeys?.handleViewChange();
  }

  private handleZoom(evt: WheelEvent) {
    const deltaYPx = evt.deltaY;
    const rect = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    const xPx = evt.clientX - rect.left - conf.PIANO_KEYBOARD_WIDTH;
    const xPercent = xPx / (this.width - conf.PIANO_KEYBOARD_WIDTH);
    const multiplier =
      deltaYPx > 0
        ? deltaYPx / conf.SCROLL_ZOOM_DOUBLE_INTERVAL_PX
        : // We adjust the multiplier to make it reversable so zooming in and then zooming out
          // by the same amount puts the zoom at the same point as before.
          1 - 1 / (1 + -deltaYPx / conf.SCROLL_ZOOM_DOUBLE_INTERVAL_PX);
    const widthBeats = this.pxToBeats(this.width);
    const endBeat = this.view.scrollHorizontalBeats + widthBeats;

    const leftBeatsToAdd = xPercent * multiplier * widthBeats * (evt.deltaY > 0 ? -1 : 1);
    const rightBeatsToAdd = (1 - xPercent) * multiplier * widthBeats * (evt.deltaY > 0 ? 1 : -1);
    this.view.scrollHorizontalBeats = Math.max(0, this.view.scrollHorizontalBeats + leftBeatsToAdd);
    const newEndBeat = Math.max(this.view.scrollHorizontalBeats + 1, endBeat + rightBeatsToAdd);
    const newWidthBeats = newEndBeat - this.view.scrollHorizontalBeats;
    this.view.pxPerBeat = this.width / newWidthBeats;

    this.handleViewChange();
  }

  private initEventHandlers() {
    this.eventHandlerCBs = {
      keyDown: (evt: KeyboardEvent) => {
        if (this.isHidden) {
          return;
        }

        switch (evt.code) {
          case 'ControlLeft':
          case 'ControlRight': {
            this.multiSelectEnabled = true;
            break;
          }
          case 'ShiftLeft':
          case 'ShiftRight': {
            this.selectionBoxButtonDown = true;
            break;
          }
          case 'Delete': {
            for (const id of this.selectedNoteIDs) {
              this.deleteNote(id);
            }
            this.selectedNoteIDs.clear();
            break;
          }
          case 'KeyC': {
            if (this.multiSelectEnabled) {
              this.copySelection();
            }
            break;
          }
          case 'KeyX': {
            if (this.multiSelectEnabled) {
              this.cutSelection();
            }
            break;
          }
          case 'KeyV': {
            if (this.multiSelectEnabled) {
              this.pasteSelection();
            }
            break;
          }
          case 'ArrowLeft': {
            this.view.scrollHorizontalBeats = Math.max(this.view.scrollHorizontalBeats - 1, 0);
            this.handleViewChange();
            break;
          }
          case 'ArrowRight': {
            this.view.scrollHorizontalBeats += 1;
            this.handleViewChange();
            break;
          }
        }
      },
      keyUp: (evt: KeyboardEvent) => {
        if (this.isHidden) {
          return;
        }

        if (evt.key === 'Control') {
          this.multiSelectEnabled = false;
        } else if (evt.key === 'Shift') {
          this.selectionBoxButtonDown = false;
        }
      },
      mouseUp: (evt: MouseEvent) => {
        if (this.isHidden) {
          return;
        }

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
        if (this.isHidden) {
          return;
        }

        if (evt.target !== this.app.renderer.view || this.panningData) {
          return;
        }

        if (evt.ctrlKey || evt.metaKey) {
          this.view.scrollHorizontalBeats = Math.max(
            0,
            this.view.scrollHorizontalBeats + evt.deltaX / conf.SCROLL_HORIZONTAL_FACTOR
          );
          const maxVerticalScrollPx = Math.max(
            this.lines.length * conf.LINE_HEIGHT - this.height + conf.CURSOR_GUTTER_HEIGHT + 10,
            0
          );
          this.view.scrollVerticalPx = Math.max(
            0,
            Math.min(
              maxVerticalScrollPx,
              this.view.scrollVerticalPx + evt.deltaY / conf.SCROLL_VERTICAL_FACTOR
            )
          );
          this.handleViewChange();
          return;
        }

        this.handleZoom(evt);
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

  public onHiddenStatusChanged = (isHidden: boolean) => {
    this.isHidden = isHidden;
    if (isHidden) {
      this.app.ticker.stop();
    } else {
      this.app.ticker.start();
    }
  };

  public destroy() {
    if (this.destroyed) {
      console.error('MIDI editor already destroyed');
      return;
    }

    this.destroyed = true;
    this.cleanupEventHandlers();
    try {
      this.app.destroy();
    } catch (err) {
      console.warn('Error destroying MIDI editor PIXI instance: ', err);
    }
    unregisterVcHideCb(this.vcId, this.onHiddenStatusChanged);
  }
}
