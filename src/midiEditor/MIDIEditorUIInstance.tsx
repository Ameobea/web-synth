import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import '@pixi/events';
import { destroyPIXIApp } from 'src/controls/pixiUtils';
import type {
  MIDIEditorInstance,
  MIDIEditorInstanceView,
  SerializedMIDIEditorInstance,
  SerializedMIDILine,
} from 'src/midiEditor';
import { BookmarkCursor, Cursor, CursorGutter, LoopCursor } from 'src/midiEditor/Cursor';
import type { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';
import MIDINoteBox, {
  type NoteDragHandle,
  NoteDragHandleSide,
} from 'src/midiEditor/NoteBox/MIDINoteBox';
import type { NoteBox } from 'src/midiEditor/NoteBox/NoteBox';
import NoteLine from 'src/midiEditor/NoteLine';
import PianoKeys from 'src/midiEditor/PianoKeyboard';
import SelectionBox from 'src/midiEditor/SelectionBox';
import {
  getIsVcHidden,
  registerVcHideCb,
  unregisterVcHideCb,
} from 'src/ViewContextManager/VcHideStatusRegistry';
import * as conf from './conf';
import type { FederatedPointerEvent } from '@pixi/events';
import { UnreachableError } from 'src/util';
import type { Unsubscribe } from 'redux';
import { subscribeToConnections, type ConnectionDescriptor } from 'src/redux/modules/vcmUtils';
import { MIDINode, type MIDINodeMetadata } from 'src/patchNetwork/midiNode';
import { get } from 'svelte/store';
import { BookmarkPosBeats } from 'src/eventScheduler';

export interface Note {
  id: number;
  startPoint: number;
  /**
   * Length of the note in beats
   */
  length: number;
}

if (PIXI.settings.RENDER_OPTIONS) {
  PIXI.settings.RENDER_OPTIONS.hello = false;
}

interface MIDIEditorPanningView {
  scrollHorizontalBeats: number;
  scrollVerticalPx: number;
}

interface DragData {
  globalStartPoint: PIXI.Point;
  originalPosBeatsByNoteId: Map<number, number>;
  startLineIx: number;
}

interface ResizeData {
  globalStartPoint: PIXI.Point;
  side: NoteDragHandleSide;
  originalPosBeatsByNoteId: Map<number, number>;
  dragHandlesByNoteID: Map<number, NoteDragHandle>;
}

const dpr = window.devicePixelRatio ?? 1;

export default class MIDIEditorUIInstance {
  public width: number;
  public height: number;
  public parentInstance: MIDIEditorInstance;
  public managedInst: ManagedMIDIEditorUIInstance;
  public app: PIXI.Application;
  public get wasm() {
    return this.managedInst.wasm;
  }
  public linesContainer: PIXI.Container;
  public lines: NoteLine[] = [];
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
  private panningData: { startPoint: PIXI.Point; startView: MIDIEditorPanningView } | null = null;
  private resizeData: ResizeData | null = null;
  private dragData: DragData | null = null;
  private handlePointerMove: (evt: FederatedPointerEvent) => void;
  private selectionBox: SelectionBox | null = null;
  public selectionBoxButtonDown = false;
  public cursor: Cursor;
  private pianoKeys: PianoKeys | undefined;
  private cursorGutter: CursorGutter;
  public loopCursor: LoopCursor | null;
  private bookmarkCursor: BookmarkCursor | null = null;
  private unsubBookmarkPosBeatsChanges: Unsubscribe;
  private clipboard: { startPoint: number; length: number; lineIx: number }[] = [];
  public noteMetadataByNoteID: Map<number, any> = new Map();
  public vcId: string;
  private isHidden: boolean;
  private unsubscribeConnectablesUpdates: Unsubscribe;
  private midiMetadataUnsubscribers: (() => void)[] = [];
  private isUnsubscribingMIDIMetadataListeners = false;
  private connectedOutputMIDINodeMetadataStores: { [outputName: string]: MIDINodeMetadata } = {};
  private destroyed = false;
  /**
   * A cache used by note lines for storing line marker sprites keyed by `${pxPerBeat}-${beatsPerMeasure}`
   */
  public markersCache: Map<string, PIXI.Texture> = new Map();

  private get beatSnapInterval(): number {
    return this.parentInstance.beatSnapInterval;
  }

  public get view(): MIDIEditorInstanceView {
    return this.managedInst.view;
  }

  constructor(
    width: number,
    height: number,
    canvas: HTMLCanvasElement,
    parentInstance: MIDIEditorInstance,
    managedInst: ManagedMIDIEditorUIInstance,
    vcId: string
  ) {
    this.width = width;
    this.height = height;
    this.parentInstance = parentInstance;
    const loopPoint = parentInstance.playbackHandler.getLoopPoint();
    this.loopCursor = loopPoint ? new LoopCursor(this, loopPoint) : null;
    this.managedInst = managedInst;
    this.vcId = vcId;

    this.app = new PIXI.Application({
      antialias: true,
      resolution: dpr,
      autoDensity: true,
      view: canvas as PIXI.ICanvas,
      height,
      width,
      backgroundColor: conf.BACKGROUND_COLOR,
    });

    this.handleBookmarkPosBeatsChange(get(BookmarkPosBeats));
    this.unsubBookmarkPosBeatsChanges = BookmarkPosBeats.subscribe(
      this.handleBookmarkPosBeatsChange
    );

    registerVcHideCb(this.vcId, this.onHiddenStatusChanged);
    this.isHidden = getIsVcHidden(this.vcId);
    this.onHiddenStatusChanged(this.isHidden);

    this.initEventHandlers();
    this.linesContainer = new PIXI.Container();
    this.linesContainer.interactive = true;
    this.linesContainer.interactiveChildren = true;

    this.handlePointerMove = (evt: FederatedPointerEvent) => {
      this.handlePan(evt);
      this.handleResize(evt);
      this.handleDrag(evt);
      if (this.selectionBox) {
        this.selectionBox.update(evt.getLocalPosition(this.linesContainer));
      }
    };
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.interactive = true;
    this.app.stage.on('pointermove', this.handlePointerMove);

    this.linesContainer.on('pointerdown', (evt: FederatedPointerEvent) => {
      if (evt.button === 0) {
        if (this.selectionBoxButtonDown && !this.selectionBox) {
          this.selectionBox = new SelectionBox(this, evt.getLocalPosition(this.linesContainer));
        }
      } else if (evt.button === 1) {
        this.startPanning(evt);
      }
    });

    this.linesContainer.x = conf.PIANO_KEYBOARD_WIDTH;
    this.linesContainer.y = conf.CURSOR_GUTTER_HEIGHT;
    this.app.stage.addChild(this.linesContainer);

    // Cursor gutter
    this.cursorGutter = new CursorGutter(this);

    this.cursor = new Cursor(this);
    this.cursor.setPosBeats(parentInstance.getCursorPosBeats());
    this.app.ticker.add(() => {
      this.cursor.setPosBeats(this.parentInstance.getCursorPosBeats());
      this.parentInstance.playbackHandler?.recordingCtx?.tick();
    });

    this.unsubscribeConnectablesUpdates = subscribeToConnections(this.vcId, newConnections =>
      this.handleConnectionsChanged(newConnections)
    );

    this.init().then(() => {
      if (this.destroyed) {
        return;
      }
      this.pianoKeys = new PianoKeys(this);

      this.app.stage.addChild(this.cursor.graphics);
      if (this.loopCursor) {
        this.app.stage.addChild(this.loopCursor.graphics);
      }
      if (this.bookmarkCursor) {
        this.app.stage.addChild(this.bookmarkCursor.graphics);
      }
    });
  }

  private handleBookmarkPosBeatsChange = (newBookmarkPosBeats: number | null) => {
    if (typeof newBookmarkPosBeats === 'number') {
      if (!this.bookmarkCursor) {
        this.bookmarkCursor = new BookmarkCursor(this, newBookmarkPosBeats);
        this.app.stage.addChild(this.bookmarkCursor.graphics);
      } else {
        this.bookmarkCursor.setPosBeats(newBookmarkPosBeats);
      }
    } else {
      if (this.bookmarkCursor) {
        this.app.stage.removeChild(this.bookmarkCursor.graphics);
        this.bookmarkCursor.destroy();
        this.bookmarkCursor = null;
      }
    }
  };

  private buildNoteLines = (linesWithIDs: readonly Note[][]): NoteLine[] =>
    linesWithIDs.map((notes, lineIx) => new NoteLine(this, notes, lineIx));

  private async init() {
    const linesWithIDs = await new Promise<readonly Note[][]>(resolve =>
      this.managedInst.onWasmLoaded(linesWithIDs => resolve(linesWithIDs))
    );

    this.lines = this.buildNoteLines(linesWithIDs);
  }

  public async reInitialize(newState: SerializedMIDIEditorInstance) {
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

    const linesWithIDs: Note[][] = new Array(newState.lines.length).fill(null).map(() => []);
    for (const { midiNumber, notes } of newState.lines) {
      const lineIx = newState.lines.length - midiNumber;
      for (const { length, startPoint } of notes) {
        const id = this.wasm.instance.create_note(
          this.wasm.noteLinesCtxPtr,
          lineIx,
          startPoint,
          length,
          0
        );
        linesWithIDs[lineIx].push({ id, startPoint, length });
      }
    }
    this.lines = this.buildNoteLines(linesWithIDs);

    // Destroy + re-create piano notes
    this.pianoKeys?.destroy();
    this.pianoKeys = new PianoKeys(this);

    // Adjust the view to match
    this.parentInstance.baseView.beatsPerMeasure = this.parentInstance.baseView.beatsPerMeasure;
    this.parentInstance.baseView.pxPerBeat = this.parentInstance.baseView.pxPerBeat;
    this.parentInstance.baseView.scrollHorizontalBeats =
      this.parentInstance.baseView.scrollHorizontalBeats;
    this.view.scrollVerticalPx = newState.view.scrollVerticalPx;
    this.handleViewChange();

    // Set other misc. state
    this.setLoopPoint(this.parentInstance.playbackHandler.getLoopPoint());
    this.cursor.setPosBeats(this.parentInstance.getCursorPosBeats());
  }

  public pxToBeats(px: number) {
    return px / this.parentInstance.baseView.pxPerBeat;
  }

  public beatsToPx(beats: number) {
    return beats * this.parentInstance.baseView.pxPerBeat;
  }

  public setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.app.renderer.resize(width, height);

    this.pianoKeys?.destroy();
    this.pianoKeys = new PianoKeys(this);
    this.cursorGutter.destroy();
    this.cursorGutter = new CursorGutter(this);
    this.app.stage.removeChild(this.cursor.graphics);
    this.cursor.destroy();
    this.cursor = new Cursor(this);
    this.app.stage.addChild(this.cursor.graphics);

    // need to destroy and re-create since the height is different and the
    // graphics are cached
    if (this.loopCursor) {
      this.app.stage.removeChild(this.loopCursor.graphics);
      this.loopCursor.destroy();
      const loopPoint = this.loopCursor.getPosBeats();
      this.loopCursor = new LoopCursor(this, loopPoint);
      this.app.stage.addChild(this.loopCursor.graphics);
    }
    if (this.bookmarkCursor) {
      this.app.stage.removeChild(this.bookmarkCursor.graphics);
      this.bookmarkCursor.destroy();
      this.bookmarkCursor = null;
      this.handleBookmarkPosBeatsChange(get(BookmarkPosBeats));
    }

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
      throw new UnreachableError('Tried to create note before Wasm initialized');
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
      throw new UnreachableError(
        `Tried to delete note with id=${id} but it wasn't in the all notes map`
      );
    }
    if (!this.wasm) {
      throw new UnreachableError('Tried to delete note before wasm initialized');
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
      throw new UnreachableError(`Tried to select note id=${id} but no note in map with that id`);
    }
    note.setIsSelected(true);
    this.selectedNoteIDs.add(id);
  }

  public deselectNote(id: number) {
    const note = this.allNotesByID.get(id);
    if (!note) {
      throw new UnreachableError(`Tried to deselect note id=${id} but no note in map with that id`);
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
      throw new UnreachableError(
        `Tried to resize note id=${id} but not found in all notes mapping`
      );
    } else if (!this.wasm) {
      throw new UnreachableError('Tried to resize note before Wasm initialized');
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
      throw new UnreachableError(
        `Tried to resize note id=${id} but not found in all notes mapping`
      );
    } else if (!this.wasm) {
      throw new UnreachableError('Tried to resize note before Wasm initialized');
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

  private startPanning(data: FederatedPointerEvent) {
    this.panningData = {
      startPoint: data.getLocalPosition(this.linesContainer),
      startView: {
        scrollHorizontalBeats: this.parentInstance.baseView.scrollHorizontalBeats,
        scrollVerticalPx: this.view.scrollVerticalPx,
      },
    };
  }

  private get maxVerticalScrollPx() {
    return Math.max(
      this.lines.length * conf.LINE_HEIGHT - this.height + conf.CURSOR_GUTTER_HEIGHT,
      0
    );
  }

  private handlePan(data: FederatedPointerEvent) {
    if (!this.panningData) {
      return;
    }
    const newPoint = data.getLocalPosition(this.linesContainer);
    const xDiffPx = -(newPoint.x - this.panningData.startPoint.x);
    const yDiffPx = -(newPoint.y - this.panningData.startPoint.y);

    this.view.scrollVerticalPx = R.clamp(
      0,
      this.maxVerticalScrollPx,
      this.panningData.startView.scrollVerticalPx + yDiffPx
    );

    // This triggers `handleViewChange` on all instances
    this.parentInstance.setScrollHorizontalBeats(
      Math.max(this.panningData.startView.scrollHorizontalBeats + this.pxToBeats(xDiffPx), 0)
    );
    // this.handleViewChange();
  }

  private stopPanning() {
    this.panningData = null;
  }

  public startResizingSelectedNotes(data: FederatedPointerEvent, side: NoteDragHandleSide) {
    this.resizeData = {
      globalStartPoint: data.global.clone(),
      side,
      originalPosBeatsByNoteId: new Map(),
      dragHandlesByNoteID: new Map(),
    };
    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableError(
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
        throw new UnreachableError("Cannot resize notes that don't have drag handles");
      })();
      this.resizeData.dragHandlesByNoteID.set(
        noteId,
        side === NoteDragHandleSide.Left
          ? specializedNote.leftDragHandle
          : specializedNote.rightDragHandle
      );
    }
  }

  private handleResize(data: FederatedPointerEvent) {
    if (!this.resizeData) {
      return;
    }

    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableError(
          `Note id ${noteId} is selected but is not in the global mapping`
        );
      }
      const handle = this.resizeData.dragHandlesByNoteID.get(noteId)!;

      const originalPosBeats = this.resizeData.originalPosBeatsByNoteId.get(noteId);
      if (R.isNil(originalPosBeats)) {
        throw new UnreachableError(`No original pos beats recorded for note id ${noteId}`);
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

      const snappedStart = this.parentInstance.snapBeat(note.startPoint);
      const snappedEnd = this.parentInstance.snapBeat(note.startPoint + note.length);

      if (snappedStart > note.startPoint) {
        this.resizeNoteHorizontalStart(line.index, note.startPoint, note.id, snappedStart);
      }

      if (snappedEnd < note.startPoint + note.length) {
        this.resizeNoteHorizontalEnd(line.index, note.startPoint, note.id, snappedEnd);
      }
    }

    // Step 2: Move all small notes that are < half the beat snap interval where possible, leaving them in
    // place in case of conflicts.  We do not change their lengths to avoid them collapsing into zero length.
    for (const [lineIx, notes] of selectedNotesByLineIx.entries()) {
      // Sort the notes to make them in order by start beat
      notes.sort((note1, note2) => note1.note.startPoint - note2.note.startPoint);

      const shortNotes = notes.filter(({ note }) => note.length <= this.beatSnapInterval / 2);
      shortNotes.forEach(({ note }) => {
        wasm.instance.delete_note(wasm.noteLinesCtxPtr, lineIx, note.startPoint, note.id);
        const snappedStart = this.parentInstance.snapBeat(note.startPoint);
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

      const snappedStart = this.parentInstance.snapBeat(note.startPoint);
      const snappedEnd = this.parentInstance.snapBeat(note.startPoint + note.length);

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

  public startDraggingSelectedNotes(data: FederatedPointerEvent) {
    const localY = data.getLocalPosition(this.linesContainer).y;
    this.dragData = {
      globalStartPoint: data.global.clone(),
      originalPosBeatsByNoteId: new Map(),
      startLineIx: this.computeLineIndex(localY),
    };

    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableError(
          `Note id ${noteId} is selected but is not in the global mapping`
        );
      }

      const originalPosBeats = note.note.startPoint;
      this.dragData.originalPosBeatsByNoteId.set(noteId, originalPosBeats);
    }
  }

  public gate(lineIx: number) {
    this.parentInstance.gate(this.managedInst.id, lineIx);
    this.pianoKeys?.setNotePlaying(lineIx, true);
  }

  public onGated(lineIx: number) {
    this.pianoKeys?.setNotePlaying(lineIx, true);
  }

  public onUngated(lineIx: number) {
    this.pianoKeys?.setNotePlaying(lineIx, false);
  }

  public ungate(lineIx: number) {
    this.parentInstance.ungate(this.managedInst.id, lineIx);
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

  public handleDrag(data: FederatedPointerEvent) {
    if (!this.dragData) {
      return;
    }

    const xDiffPx = data.global.x - this.dragData.globalStartPoint.x;
    const xDiffBeats = this.pxToBeats(xDiffPx);

    // We first move all of the notes horizontally before attempting any vertical movement
    for (const noteId of this.selectedNoteIDs.values()) {
      const note = this.allNotesByID.get(noteId);
      if (!note) {
        throw new UnreachableError(`Note id ${noteId} is selected but not in global mapping`);
      }

      const originalPosBeats = this.dragData.originalPosBeatsByNoteId.get(noteId);
      if (R.isNil(originalPosBeats)) {
        throw new UnreachableError(`Note id ${noteId} is selected but not in original pos mapping`);
      }
      const newDesiredStartPosBeats = Math.max(
        this.parentInstance.snapBeat(originalPosBeats + xDiffBeats),
        0
      );
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
      throw new UnreachableError('Tried to drag notes before wasm initialized');
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

  public setLoopPoint(loopPoint?: number | null | undefined) {
    const newLoopPoint = this.parentInstance.snapBeat(
      loopPoint ??
        this.parentInstance.getCursorPosBeats() + this.parentInstance.baseView.beatsPerMeasure
    );

    if (this.loopCursor) {
      if (R.isNil(loopPoint)) {
        this.app.stage.removeChild(this.loopCursor.graphics);
        this.loopCursor.destroy();
        this.loopCursor = null;
        return;
      }

      this.loopCursor.setPosBeats(newLoopPoint);
      return;
    }

    if (!R.isNil(loopPoint)) {
      this.loopCursor = new LoopCursor(this, newLoopPoint);
      this.app.stage.addChild(this.loopCursor.graphics);
    }
  }

  public serializeLines(): SerializedMIDILine[] {
    return this.lines.map((line, lineIx) => ({
      midiNumber: this.lines.length - lineIx,
      notes: [...line.notesByID.values()].map(note => ({
        startPoint: note.note.startPoint,
        length: note.note.length,
      })),
    }));
  }

  public serialize(isExpanded: boolean): SerializedMIDIEditorInstance {
    return {
      lines: this.serializeLines(),
      view: R.clone(this.view),
      isExpanded,
      name: this.managedInst.name,
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

  public handleViewChange() {
    this.view.scrollVerticalPx = R.clamp(0, this.maxVerticalScrollPx, this.view.scrollVerticalPx);

    this.lines.forEach(line => line.handleViewChange());
    this.cursor.handleViewChange();
    this.loopCursor?.handleViewChange();
    this.bookmarkCursor?.handleViewChange();
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
    const endBeat = this.parentInstance.baseView.scrollHorizontalBeats + widthBeats;

    const leftBeatsToAdd = xPercent * multiplier * widthBeats * (evt.deltaY > 0 ? -1 : 1);
    const rightBeatsToAdd = (1 - xPercent) * multiplier * widthBeats * (evt.deltaY > 0 ? 1 : -1);
    this.parentInstance.baseView.scrollHorizontalBeats = Math.max(
      0,
      this.parentInstance.baseView.scrollHorizontalBeats + leftBeatsToAdd
    );
    const newEndBeat = Math.max(
      this.parentInstance.baseView.scrollHorizontalBeats + 1,
      endBeat + rightBeatsToAdd
    );
    const newWidthBeats = newEndBeat - this.parentInstance.baseView.scrollHorizontalBeats;
    this.parentInstance.setPxPerBeat(this.width / newWidthBeats);
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
            this.parentInstance.setScrollHorizontalBeats(
              Math.max(this.parentInstance.baseView.scrollHorizontalBeats - 1, 0)
            );
            this.handleViewChange();
            break;
          }
          case 'ArrowRight': {
            this.parentInstance.setScrollHorizontalBeats(
              this.parentInstance.baseView.scrollHorizontalBeats + 1
            );
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

        // If the scroll is happening over the piano keys, we let the event bubble up
        if (evt.clientX < conf.PIANO_KEYBOARD_WIDTH) {
          return;
        }

        let stopPropagation = true;
        if (evt.shiftKey || evt.metaKey) {
          const maxVerticalScrollPx = Math.max(this.maxVerticalScrollPx, 0);
          this.view.scrollVerticalPx = Math.max(
            0,
            Math.min(
              maxVerticalScrollPx,
              this.view.scrollVerticalPx + evt.deltaY / conf.SCROLL_VERTICAL_FACTOR
            )
          );

          this.parentInstance.setScrollHorizontalBeats(
            Math.max(
              0,
              this.parentInstance.baseView.scrollHorizontalBeats +
                evt.deltaX / conf.SCROLL_HORIZONTAL_FACTOR
            )
          );
        } else if (evt.ctrlKey) {
          this.handleZoom(evt);
        } else {
          stopPropagation = false;
        }

        if (stopPropagation) {
          evt.preventDefault();
          evt.stopPropagation();
        }
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
    this.app.stage.off('pointermove', this.handlePointerMove);
    this.unsubBookmarkPosBeatsChanges();
  }

  public onHiddenStatusChanged = (isHidden: boolean) => {
    this.isHidden = isHidden;
    if (isHidden) {
      this.app.ticker.stop();
    } else {
      this.app.ticker.start();
    }
  };

  private handleConnectionsChanged = (
    newConnections:
      | {
          inputs: ConnectionDescriptor[];
          outputs: ConnectionDescriptor[];
        }
      | undefined
  ) => {
    this.unsubMIDIMetadataListeners();

    const connectedOutputs = newConnections?.outputs || [];
    connectedOutputs.forEach((conn, outputName) => {
      if (!(conn.rxNode instanceof MIDINode)) {
        return;
      }

      const unsubInner = conn.rxNode.metadata.subscribe(metadata => {
        this.connectedOutputMIDINodeMetadataStores[outputName] = metadata;
        this.handleMIDIOutputMetadataChange();
      });
      const unsub = () => {
        delete this.connectedOutputMIDINodeMetadataStores[outputName];
        unsubInner();
        this.handleMIDIOutputMetadataChange();
      };
      this.midiMetadataUnsubscribers.push(unsub);
    });
  };

  private unsubMIDIMetadataListeners() {
    this.isUnsubscribingMIDIMetadataListeners = true;
    this.midiMetadataUnsubscribers.forEach(unsub => unsub());
    this.midiMetadataUnsubscribers = [];
    this.isUnsubscribingMIDIMetadataListeners = false;
  }

  private handleMIDIOutputMetadataChange() {
    if (this.isUnsubscribingMIDIMetadataListeners) {
      return;
    }

    const labelByLineIx: Map<number, string> = new Map();

    for (const metadata of Object.values(this.connectedOutputMIDINodeMetadataStores)) {
      for (const [midiNumber, noteMetadata] of metadata.noteMetadata) {
        const lineIx = this.lines.length - midiNumber;
        if (noteMetadata.name && !labelByLineIx.has(lineIx)) {
          labelByLineIx.set(lineIx, noteMetadata.name);
        }
      }
    }

    this.lines.forEach((line, lineIx) => {
      const label = labelByLineIx.get(lineIx);
      line.setLabel(label);
    });
  }

  public destroy() {
    if (this.destroyed) {
      console.error('MIDI editor already destroyed');
      return;
    }

    this.destroyed = true;
    this.cleanupEventHandlers();
    this.unsubscribeConnectablesUpdates();
    this.unsubMIDIMetadataListeners();
    try {
      destroyPIXIApp(this.app);
    } catch (err) {
      console.warn('Error destroying MIDI editor PIXI instance: ', err);
    }
    unregisterVcHideCb(this.vcId, this.onHiddenStatusChanged);
  }
}
