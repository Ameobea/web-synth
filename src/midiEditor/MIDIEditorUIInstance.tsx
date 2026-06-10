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
import BackgroundRenderer from 'src/midiEditor/BackgroundRenderer';
import { BookmarkCursor, Cursor, CursorGutter, LoopCursor } from 'src/midiEditor/Cursor';
import InteractionManager from 'src/midiEditor/InteractionManager';
import type { ManagedMIDIEditorUIInstance } from 'src/midiEditor/MIDIEditorUIManager';
import NoteRenderer from 'src/midiEditor/NoteRenderer';
import PianoKeys from 'src/midiEditor/PianoKeyboard';
import * as conf from './conf';
import { UnreachableError, clamp } from 'src/util';
import type { Unsubscribe } from 'redux';
import { subscribeToConnections, type ConnectionDescriptor } from 'src/redux/modules/vcmUtils';
import { MIDINode, type MIDINodeMetadata } from 'src/patchNetwork/midiNode';
import { get } from 'svelte/store';
import { BookmarkPosBeats } from 'src/eventScheduler';

export type { Note } from 'src/midiEditor/NoteStore';

if (PIXI.settings.RENDER_OPTIONS) {
  PIXI.settings.RENDER_OPTIONS.hello = false;
}

const dpr = window.devicePixelRatio ?? 1;

export default class MIDIEditorUIInstance {
  public width: number;
  public height: number;
  public parentInstance: MIDIEditorInstance;
  public managedInst: ManagedMIDIEditorUIInstance;
  public app: PIXI.Application;
  public get notes() {
    return this.managedInst.notes;
  }
  public selectedNoteIDs: Set<number> = new Set();
  public multiSelectEnabled = false;
  public selectionBoxButtonDown = false;
  /** Holds the selection box graphics + line labels; positioned at the note grid's origin */
  public overlayContainer: PIXI.Container;
  private backgroundRenderer: BackgroundRenderer;
  private noteRenderer: NoteRenderer;
  private interactionManager: InteractionManager;
  private eventHandlerCBs!: {
    keyUp: (evt: KeyboardEvent) => void;
    keyDown: (evt: KeyboardEvent) => void;
    mouseUp: (evt: MouseEvent) => void;
    wheel: (evt: WheelEvent) => void;
  };
  private mouseUpCBs: (() => void)[] = [];
  public cursor: Cursor;
  private pianoKeys: PianoKeys | undefined;
  private cursorGutter: CursorGutter;
  public loopCursor: LoopCursor | null;
  private bookmarkCursor: BookmarkCursor | null = null;
  private unsubBookmarkPosBeatsChanges: Unsubscribe;
  private clipboard: { startPoint: number; length: number; lineIx: number; velocity: number }[] =
    [];
  public vcId: string;
  private unsubscribeConnectablesUpdates: Unsubscribe;
  private midiMetadataUnsubscribers: (() => void)[] = [];
  private isUnsubscribingMIDIMetadataListeners = false;
  private connectedOutputMIDINodeMetadataStores: { [outputName: string]: MIDINodeMetadata } = {};
  private labelsByLineIx: Map<number, PIXI.Text> = new Map();
  private destroyed = false;
  private needsRender = true;
  private notesDirty = true;

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
      eventFeatures: { wheel: false },
    });

    this.handleBookmarkPosBeatsChange(get(BookmarkPosBeats));
    this.unsubBookmarkPosBeatsChanges = BookmarkPosBeats.subscribe(
      this.handleBookmarkPosBeatsChange
    );

    this.initEventHandlers();

    this.backgroundRenderer = new BackgroundRenderer(this);
    this.noteRenderer = new NoteRenderer(this);
    this.overlayContainer = new PIXI.Container();
    this.overlayContainer.x = conf.PIANO_KEYBOARD_WIDTH;
    this.overlayContainer.y = conf.CURSOR_GUTTER_HEIGHT;
    this.app.stage.addChild(this.backgroundRenderer);
    this.app.stage.addChild(this.noteRenderer);
    this.app.stage.addChild(this.overlayContainer);

    // PIXI's event system owns the piano keyboard strip and cursor gutter; the
    // InteractionManager owns all pointer handling within the note grid
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.interactive = true;
    this.interactionManager = new InteractionManager(this);

    this.cursorGutter = new CursorGutter(this);

    this.cursor = new Cursor(this);
    this.cursor.setPosBeats(parentInstance.getCursorPosBeats());

    // render-on-demand: unhook the ticker's automatic render and only render when dirty
    this.app.ticker.remove(this.app.render, this.app);
    this.app.ticker.add(this.onTick);

    this.unsubscribeConnectablesUpdates = subscribeToConnections(this.vcId, newConnections =>
      this.handleConnectionsChanged(newConnections)
    );

    this.pianoKeys = new PianoKeys(this);
    this.app.stage.addChild(this.cursor.graphics);
    if (this.loopCursor) {
      this.app.stage.addChild(this.loopCursor.graphics);
    }
    if (this.bookmarkCursor) {
      this.app.stage.addChild(this.bookmarkCursor.graphics);
    }

    this.handleViewChange();
    this.refreshOnFontLoad();
  }

  /**
   * Canvas text rendering neither triggers CSS `@font-face` loading nor re-rasterizes once a
   * font arrives, so labels rendered before the fonts load get stuck with a fallback font.
   */
  private refreshOnFontLoad() {
    const fonts = ['12px Hack', '13px "IBM Plex Sans"'];
    if (!document.fonts || fonts.every(font => document.fonts.check(font))) {
      return;
    }

    Promise.all(fonts.map(font => document.fonts.load(font)))
      .then(() => {
        if (this.destroyed) {
          return;
        }
        for (const text of this.labelsByLineIx.values()) {
          text.dirty = true;
        }
        this.pianoKeys?.destroy();
        this.pianoKeys = new PianoKeys(this);
        this.markDirty();
      })
      .catch(() => {});
  }

  private onTick = () => {
    const oldCursorX = this.cursor.graphics.x;
    const oldCursorAlpha = this.cursor.graphics.alpha;
    this.cursor.setPosBeats(this.parentInstance.getCursorPosBeats());
    if (this.cursor.graphics.x !== oldCursorX || this.cursor.graphics.alpha !== oldCursorAlpha) {
      this.markDirty();
    }

    this.parentInstance.playbackHandler?.recordingCtx?.tick();

    if (this.notesDirty) {
      this.notesDirty = false;
      this.noteRenderer.sync();
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.app.render();
    }
  };

  public markDirty() {
    this.needsRender = true;
  }

  /** Marks the note instance buffer as stale; it will be re-written from the store next frame */
  public onNotesChanged() {
    this.notesDirty = true;
    this.needsRender = true;
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
    this.markDirty();
  };

  public reInitialize(newState: SerializedMIDIEditorInstance) {
    this.selectedNoteIDs.clear();

    this.notes.clear();
    this.notes.setLineCount(newState.lines.length);
    for (const { midiNumber, notes } of newState.lines) {
      const lineIx = newState.lines.length - midiNumber;
      if (lineIx < 0 || lineIx >= newState.lines.length) {
        console.error(`Invalid midiNumber=${midiNumber} in serialized state; skipping`);
        continue;
      }
      for (const { length, startPoint, velocity } of notes) {
        this.notes.addNote(lineIx, startPoint, length, velocity ?? 90);
      }
    }

    // Destroy + re-create piano notes
    this.pianoKeys?.destroy();
    this.pianoKeys = new PianoKeys(this);

    // Adjust the view to match
    this.view.scrollVerticalPx = newState.view.scrollVerticalPx;
    this.handleMIDIOutputMetadataChange();
    this.handleViewChange();

    // Set other misc. state
    this.setLoopPoint(this.parentInstance.playbackHandler.getLoopPoint());
    this.cursor.setPosBeats(this.parentInstance.getCursorPosBeats());
    this.managedInst.lastSetNoteVelocity = newState.lastSetNoteVelocity ?? 90;
    this.onNotesChanged();
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
    this.backgroundRenderer.handleResize();
    this.noteRenderer.handleResize();

    this.pianoKeys?.destroy();
    this.pianoKeys = new PianoKeys(this);
    this.cursorGutter.destroy();
    this.cursorGutter = new CursorGutter(this);
    this.app.stage.removeChild(this.cursor.graphics);
    this.cursor.destroy();
    this.cursor = new Cursor(this);
    this.cursor.setPosBeats(this.parentInstance.getCursorPosBeats());
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
  public addNote(lineIx: number, startPoint: number, length: number, velocity: number): number {
    const id = this.notes.addNote(lineIx, startPoint, length, velocity);
    this.selectNote(id);
    this.onNotesChanged();
    return id;
  }

  public deleteNote(id: number) {
    if (!this.notes.getNote(id)) {
      throw new UnreachableError(`Tried to delete note with id=${id} but it isn't in the store`);
    }
    this.selectedNoteIDs.delete(id);
    this.notes.deleteNote(id);
    this.onNotesChanged();
  }

  public selectNote(id: number) {
    if (!this.multiSelectEnabled && !this.selectionBoxButtonDown) {
      this.deselectAllNotes();
    }

    if (!this.notes.getNote(id)) {
      throw new UnreachableError(`Tried to select note id=${id} but no note in store with that id`);
    }
    this.selectedNoteIDs.add(id);
    this.onNotesChanged();
  }

  public deselectNote(id: number) {
    const wasRemoved = this.selectedNoteIDs.delete(id);
    if (!wasRemoved) {
      console.warn(`Note id=${id} wasn't in the selected notes set when deselecting`);
    }
    this.onNotesChanged();
  }

  public deselectAllNotes() {
    this.selectedNoteIDs.clear();
    this.onNotesChanged();
  }

  public resizeNoteHorizontalStart(id: number, newStartPoint: number): number {
    const note = this.notes.getNote(id);
    if (!note) {
      throw new UnreachableError(`Tried to resize note id=${id} but not found in store`);
    }

    const endPoint = note.startPoint + note.length;
    const newLengthPx = Math.max(
      this.beatsToPx(endPoint - newStartPoint),
      conf.MIN_DRAWING_NOTE_WIDTH_PX
    );
    newStartPoint = endPoint - this.pxToBeats(newLengthPx);

    const realNewStartPoint = this.notes.resizeNoteStart(id, newStartPoint);
    this.onNotesChanged();
    return realNewStartPoint;
  }

  public resizeNoteHorizontalEnd(id: number, newEndPoint: number): number {
    const note = this.notes.getNote(id);
    if (!note) {
      throw new UnreachableError(`Tried to resize note id=${id} but not found in store`);
    }

    const startPoint = note.startPoint;
    const newLengthPx = Math.max(
      this.beatsToPx(newEndPoint - startPoint),
      conf.MIN_DRAWING_NOTE_WIDTH_PX
    );
    newEndPoint = startPoint + this.pxToBeats(newLengthPx);

    const realNewEndPoint = this.notes.resizeNoteEnd(id, newEndPoint);
    this.onNotesChanged();
    return realNewEndPoint;
  }

  public setNoteVelocity(noteID: number, newVelocity: number) {
    this.notes.setNoteVelocity(noteID, newVelocity);
    this.onNotesChanged();
  }

  public get maxVerticalScrollPx() {
    return Math.max(
      this.notes.lineCount * conf.LINE_HEIGHT - this.height + conf.CURSOR_GUTTER_HEIGHT,
      0
    );
  }

  public copySelection() {
    this.clipboard = [];
    for (const noteID of this.selectedNoteIDs.values()) {
      const note = this.notes.getNote(noteID)!;
      this.clipboard.push({
        lineIx: this.notes.getLineIx(noteID)!,
        startPoint: note.startPoint,
        length: note.length,
        velocity: note.velocity,
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
    if (R.isEmpty(this.clipboard)) {
      return;
    }

    const cursorPosBeats = this.parentInstance.playbackHandler.getCursorPosBeats();
    const startBeat = Math.min(...this.clipboard.map(R.prop('startPoint')));
    const endBeat = Math.max(...this.clipboard.map(note => note.startPoint + note.length));

    this.deselectAllNotes();

    const createdNoteIDs: number[] = [];
    this.clipboard.forEach(note => {
      const normalizedStartPoint = note.startPoint - startBeat + cursorPosBeats;
      if (!this.notes.checkCanAddNote(note.lineIx, normalizedStartPoint, note.length)) {
        return;
      }
      const id = this.addNote(note.lineIx, normalizedStartPoint, note.length, note.velocity);
      createdNoteIDs.push(id);
    });

    this.deselectAllNotes();
    createdNoteIDs.forEach(id => this.selectNote(id));
    const normalizedEndBeat = endBeat - startBeat + cursorPosBeats;
    this.parentInstance.playbackHandler.setCursorPosBeats(normalizedEndBeat);
  }

  public clearAllNotes() {
    this.selectedNoteIDs.clear();
    this.notes.clear();
    this.onNotesChanged();
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
    const halfSnap = this.beatSnapInterval / 2;
    const snap = (b: number) => this.parentInstance.snapBeat(b);

    // shrink-only pass (conflict-free): move start later, move end earlier
    for (const noteID of this.selectedNoteIDs.values()) {
      const note = this.notes.getNote(noteID)!;
      if (note.length <= halfSnap) {
        continue;
      }
      const snappedStart = snap(note.startPoint);
      if (snappedStart > note.startPoint) {
        this.notes.resizeNoteStart(note.id, snappedStart);
      }
      const curEnd = note.startPoint + note.length;
      const snappedEnd = snap(curEnd);
      if (snappedEnd > note.startPoint && snappedEnd < curEnd) {
        this.notes.resizeNoteEnd(note.id, snappedEnd);
      }
    }

    // small-note move pass: only commit if exact snap fits, else leave in place
    for (const noteID of this.selectedNoteIDs.values()) {
      const note = this.notes.getNote(noteID)!;
      if (note.length > halfSnap) {
        continue;
      }
      const snappedStart = snap(note.startPoint);
      if (snappedStart === note.startPoint) {
        continue;
      }
      const original = note.startPoint;
      const real = this.notes.moveNoteHorizontal(note.id, snappedStart);
      if (real !== snappedStart) {
        this.notes.moveNoteHorizontal(note.id, original);
      }
    }

    // extend pass: grow start left / end right where possible (resize already clamps to neighbours)
    for (const noteID of this.selectedNoteIDs.values()) {
      const note = this.notes.getNote(noteID)!;
      if (note.length <= halfSnap) {
        continue;
      }
      const snappedStart = snap(note.startPoint);
      if (snappedStart < note.startPoint) {
        this.notes.resizeNoteStart(note.id, snappedStart);
      }
      const snappedEnd = snap(note.startPoint + note.length);
      if (snappedEnd > note.startPoint + note.length) {
        this.notes.resizeNoteEnd(note.id, snappedEnd);
      }
    }

    this.onNotesChanged();
  }

  public setVelocityDisplayEnabled(velocityDisplayEnabled: boolean) {
    this.noteRenderer.setVelocityDisplayEnabled(velocityDisplayEnabled);
    this.markDirty();
  }

  public computeLineIndex(localY: number) {
    const adjustedY = localY + this.view.scrollVerticalPx;
    return Math.floor(adjustedY / conf.LINE_HEIGHT);
  }

  public gate(lineIx: number, velocity: number) {
    this.parentInstance.gate(this.managedInst.id, lineIx, velocity);
    this.pianoKeys?.setNotePlaying(lineIx, true);
    this.markDirty();
  }

  public onGated(lineIx: number) {
    this.pianoKeys?.setNotePlaying(lineIx, true);
    this.markDirty();
  }

  public onUngated(lineIx: number) {
    this.pianoKeys?.setNotePlaying(lineIx, false);
    this.markDirty();
  }

  public ungate(lineIx: number) {
    this.parentInstance.ungate(this.managedInst.id, lineIx);
    this.pianoKeys?.setNotePlaying(lineIx, false);
    this.markDirty();
  }

  public gateAllSelectedNotes() {
    const gatedVelocitiesByLineIx: Map<number, number> = new Map();
    for (const noteID of this.selectedNoteIDs) {
      const note = this.notes.getNote(noteID)!;
      const lineIx = this.notes.getLineIx(noteID)!;
      const prev = gatedVelocitiesByLineIx.get(lineIx);
      gatedVelocitiesByLineIx.set(
        lineIx,
        prev === undefined ? note.velocity : Math.max(prev, note.velocity)
      );
    }
    for (const [lineIx, velocity] of gatedVelocitiesByLineIx) {
      this.gate(lineIx, velocity);
    }
  }

  public ungateAllSelectedNotes() {
    const allGatedLineIndices = new Set(
      [...this.selectedNoteIDs].map(noteId => this.notes.getLineIx(noteId)!)
    );
    for (const lineIx of allGatedLineIndices) {
      this.ungate(lineIx);
    }
  }

  public setLoopPoint(loopPoint?: number | null | undefined) {
    const newLoopPoint = this.parentInstance.snapBeat(
      loopPoint ??
        this.parentInstance.getCursorPosBeats() + this.parentInstance.baseView.beatsPerMeasure
    );
    this.markDirty();

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
    return this.managedInst.serializeLines();
  }

  public serialize(isExpanded: boolean): SerializedMIDIEditorInstance {
    return {
      lines: this.serializeLines(),
      view: R.clone(this.view),
      isExpanded,
      name: this.managedInst.name,
      lastSetNoteVelocity: this.managedInst.lastSetNoteVelocity,
    };
  }

  /**
   * Encodes all notes into a buffer representing `RawNoteData` structs from the `common` Wasm crate.
   *
   * This is passed into Wasm and used export MIDI files.
   */
  public exportToRawNoteDataBuffer(): Uint8Array {
    const totalNoteCount = this.notes.noteCount;
    const rawNoteSizeBytes = 4 + 8 + 8 + 4; // note number, start_beat, length, padding
    const buffer = new Uint8Array(rawNoteSizeBytes * totalNoteCount);
    const u32View = new Uint32Array(buffer.buffer);
    const f64View = new Float64Array(buffer.buffer);

    let entryCount = 0;
    for (let lineIx = 0; lineIx < this.notes.lineCount; lineIx++) {
      const midiNumber = this.notes.lineCount - lineIx;
      for (const note of this.notes.getLine(lineIx)) {
        const u32BufferOffset = entryCount * 6;
        u32View[u32BufferOffset] = midiNumber;

        const f64BufferOffset = entryCount * 3;
        f64View[f64BufferOffset + 1] = note.startPoint;
        f64View[f64BufferOffset + 2] = note.length;

        entryCount += 1;
      }
    }

    return buffer;
  }

  public handleViewChange() {
    this.view.scrollVerticalPx = R.clamp(0, this.maxVerticalScrollPx, this.view.scrollVerticalPx);

    this.backgroundRenderer.handleViewChange();
    this.noteRenderer.handleViewChange();
    this.updateLabelPositions();
    this.cursor.handleViewChange();
    this.loopCursor?.handleViewChange();
    this.bookmarkCursor?.handleViewChange();
    this.pianoKeys?.handleViewChange();
    this.markDirty();
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
            break;
          }
          case 'ArrowRight': {
            this.parentInstance.setScrollHorizontalBeats(
              this.parentInstance.baseView.scrollHorizontalBeats + 1
            );
            break;
          }
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
          this.flushMouseUpCBs();
        }
      },
      wheel: (evt: WheelEvent) => {
        if (evt.target !== this.app.renderer.view) {
          return;
        }

        // If the scroll is happening over the piano keys, we let the event bubble up
        if (evt.clientX < conf.PIANO_KEYBOARD_WIDTH) {
          return;
        }

        let stopPropagation = true;
        if (evt.shiftKey || evt.metaKey) {
          this.view.scrollVerticalPx = Math.max(
            0,
            Math.min(
              this.maxVerticalScrollPx,
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
        } else if (this.parentInstance.uiManager.velocityDisplayEnabled) {
          const note = this.interactionManager.noteAtCanvasPos(evt.offsetX, evt.offsetY);
          if (note) {
            this.setNoteVelocity(note.id, clamp(0, 127, note.velocity - Math.sign(evt.deltaY)));
          } else {
            stopPropagation = false;
          }
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

  public flushMouseUpCBs() {
    const cbs = this.mouseUpCBs;
    this.mouseUpCBs = [];
    cbs.forEach(cb => cb());
  }

  private cleanupEventHandlers() {
    document.removeEventListener('keydown', this.eventHandlerCBs.keyDown);
    document.removeEventListener('keyup', this.eventHandlerCBs.keyUp);
    document.removeEventListener('mouseup', this.eventHandlerCBs.mouseUp);
    document.removeEventListener('wheel', this.eventHandlerCBs.wheel);
    this.unsubBookmarkPosBeatsChanges();
  }

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
        const lineIx = this.notes.lineCount - midiNumber;
        if (noteMetadata.name && !labelByLineIx.has(lineIx)) {
          labelByLineIx.set(lineIx, noteMetadata.name);
        }
      }
    }

    for (const [lineIx, text] of [...this.labelsByLineIx.entries()]) {
      if (!labelByLineIx.has(lineIx)) {
        this.overlayContainer.removeChild(text);
        text.destroy();
        this.labelsByLineIx.delete(lineIx);
      }
    }
    for (const [lineIx, label] of labelByLineIx) {
      const existing = this.labelsByLineIx.get(lineIx);
      if (existing) {
        existing.text = label;
      } else {
        const text = new PIXI.Text(label, {
          fontSize: 12,
          fill: conf.LINE_LABEL_COLOR,
          fontFamily: 'Hack',
        });
        text.x = 4;
        this.overlayContainer.addChild(text);
        this.labelsByLineIx.set(lineIx, text);
      }
    }

    this.updateLabelPositions();
    this.markDirty();
  }

  private updateLabelPositions() {
    for (const [lineIx, text] of this.labelsByLineIx) {
      const y = lineIx * conf.LINE_HEIGHT - this.view.scrollVerticalPx + 1;
      text.y = y;
      text.visible = y > -conf.LINE_HEIGHT && y < this.height;
    }
  }

  public destroy() {
    if (this.destroyed) {
      console.error('MIDI editor already destroyed');
      return;
    }

    this.destroyed = true;
    this.cleanupEventHandlers();
    this.interactionManager.destroy();
    this.unsubscribeConnectablesUpdates();
    this.unsubMIDIMetadataListeners();
    try {
      destroyPIXIApp(this.app);
    } catch (err) {
      console.warn('Error destroying MIDI editor PIXI instance: ', err);
    }
  }
}
