import * as R from 'ramda';

import * as PIXI from 'src/controls/pixi';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import type { Note } from 'src/midiEditor/NoteStore';
import { clamp } from 'src/util';
import * as conf from './conf';

export interface GridPos {
  /** Grid-local CSS px; 0 = left edge of the note grid (right edge of the piano keyboard) */
  xPx: number;
  /** Grid-local CSS px; 0 = top of the note grid (bottom of the cursor gutter) */
  yPx: number;
  /** Unsnapped beat under the pointer */
  beat: number;
  lineIx: number;
}

export interface DragSession {
  onMove(pos: GridPos, evt: PointerEvent): void;
  /** Also invoked on pointercancel */
  onUp(pos: GridPos): void;
}

interface HitLayer {
  /** Returns a session to own the gesture, or null to fall through to the next layer */
  hitTest(pos: GridPos, evt: PointerEvent): DragSession | null;
  hoverCursor?(pos: GridPos): string | null;
}

const NOOP_SESSION: DragSession = { onMove() {}, onUp() {} };

export enum NoteDragHandleSide {
  Left,
  Right,
}

const computeHandleWidthPx = (noteWidthPx: number): number =>
  noteWidthPx >= 20 ? 8 : Math.max(Math.floor((noteWidthPx - 6) / 2), 3);

/**
 * Pointer position relative to the note's visual left edge (which extends 1px left of the note's
 * start point, matching the old `NoteBox` graphics origin).
 */
const noteLocalXPx = (app: MIDIEditorUIInstance, note: Note, pos: GridPos): number => {
  const startPx = app.beatsToPx(
    note.startPoint - app.parentInstance.baseView.scrollHorizontalBeats
  );
  return pos.xPx - (startPx - 1);
};

class PanSession implements DragSession {
  private app: MIDIEditorUIInstance;
  private startPos: GridPos;
  private startView: { scrollHorizontalBeats: number; scrollVerticalPx: number };

  constructor(app: MIDIEditorUIInstance, pos: GridPos) {
    this.app = app;
    this.startPos = pos;
    this.startView = {
      scrollHorizontalBeats: app.parentInstance.baseView.scrollHorizontalBeats,
      scrollVerticalPx: app.view.scrollVerticalPx,
    };
  }

  public onMove(pos: GridPos) {
    const xDiffPx = -(pos.xPx - this.startPos.xPx);
    const yDiffPx = -(pos.yPx - this.startPos.yPx);

    this.app.view.scrollVerticalPx = R.clamp(
      0,
      this.app.maxVerticalScrollPx,
      this.startView.scrollVerticalPx + yDiffPx
    );
    // triggers `handleViewChange` on all instances
    this.app.parentInstance.setScrollHorizontalBeats(
      Math.max(this.startView.scrollHorizontalBeats + this.app.pxToBeats(xDiffPx), 0)
    );
  }

  public onUp() {}
}

class SelectionBoxSession implements DragSession {
  private app: MIDIEditorUIInstance;
  private startPos: GridPos;
  private graphics: PIXI.Graphics;

  constructor(app: MIDIEditorUIInstance, pos: GridPos) {
    this.app = app;
    this.startPos = pos;
    this.graphics = new PIXI.Graphics();
    app.overlayContainer.addChild(this.graphics);
    this.update(pos);
  }

  private update(pos: GridPos) {
    const minX = Math.min(this.startPos.xPx, pos.xPx);
    const maxX = Math.max(this.startPos.xPx, pos.xPx);
    const minY = Math.min(this.startPos.yPx, pos.yPx);
    const maxY = Math.max(this.startPos.yPx, pos.yPx);

    this.graphics.clear();
    this.graphics.lineStyle(1, conf.SELECTION_BOX_BORDER_COLOR);
    this.graphics.beginFill(conf.SELECTION_BOX_FILL_COLOR, 0.3);
    this.graphics.drawRect(minX, minY, maxX - minX, maxY - minY);
    this.graphics.endFill();

    const scrollBeats = this.app.parentInstance.baseView.scrollHorizontalBeats;
    const newSelectedNotes = this.app.notes.iterRangeIds(
      this.app.computeLineIndex(minY),
      this.app.computeLineIndex(maxY),
      this.app.pxToBeats(minX) + scrollBeats,
      this.app.pxToBeats(maxX) + scrollBeats
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
    this.app.markDirty();
  }

  public onMove(pos: GridPos) {
    this.update(pos);
  }

  public onUp() {
    this.app.overlayContainer.removeChild(this.graphics);
    this.graphics.destroy();
    this.app.markDirty();
  }
}

class VelocityDragSession implements DragSession {
  private app: MIDIEditorUIInstance;
  private note: Note;
  private startXPx: number;
  private initialVelocity: number;

  constructor(app: MIDIEditorUIInstance, note: Note, pos: GridPos) {
    this.app = app;
    this.note = note;
    this.startXPx = pos.xPx;
    this.initialVelocity = note.velocity;
  }

  public onMove(pos: GridPos) {
    const effectiveWidth = this.app.beatsToPx(this.note.length) - 2;
    if (effectiveWidth <= 0) {
      return;
    }
    const initialBarWidth = Math.floor((effectiveWidth * this.initialVelocity) / 127);
    const newBarWidth = clamp(0, effectiveWidth, initialBarWidth + (pos.xPx - this.startXPx));
    const newVelocity = clamp(0, 127, Math.floor((newBarWidth * 127) / effectiveWidth));
    this.app.setNoteVelocity(this.note.id, newVelocity);
  }

  public onUp() {}
}

class ResizeSession implements DragSession {
  private app: MIDIEditorUIInstance;
  private side: NoteDragHandleSide;
  private startXPx: number;
  private originalPosBeatsByNoteId: Map<number, number> = new Map();

  constructor(app: MIDIEditorUIInstance, pos: GridPos, side: NoteDragHandleSide) {
    this.app = app;
    this.side = side;
    this.startXPx = pos.xPx;
    for (const noteId of app.selectedNoteIDs.values()) {
      const note = app.notes.getNote(noteId)!;
      this.originalPosBeatsByNoteId.set(
        noteId,
        side === NoteDragHandleSide.Left ? note.startPoint : note.startPoint + note.length
      );
    }
  }

  public onMove(pos: GridPos) {
    const diffBeats = this.app.pxToBeats(pos.xPx - this.startXPx);
    for (const [noteId, originalPosBeats] of this.originalPosBeatsByNoteId.entries()) {
      const note = this.app.notes.getNote(noteId);
      if (!note) {
        continue;
      }
      const newPosBeats = this.app.parentInstance.snapBeat(originalPosBeats + diffBeats);
      const newLength =
        this.side === NoteDragHandleSide.Left
          ? note.startPoint + note.length - newPosBeats
          : newPosBeats - note.startPoint;
      if (newLength <= 0) {
        continue;
      }

      if (this.side === NoteDragHandleSide.Left) {
        this.app.resizeNoteHorizontalStart(noteId, newPosBeats);
      } else {
        this.app.resizeNoteHorizontalEnd(noteId, newPosBeats);
      }
    }
  }

  public onUp() {}
}

class NoteDragSession implements DragSession {
  private app: MIDIEditorUIInstance;
  private startXPx: number;
  private startLineIx: number;
  private originalPosBeatsByNoteId: Map<number, number> = new Map();

  constructor(app: MIDIEditorUIInstance, pos: GridPos) {
    this.app = app;
    this.startXPx = pos.xPx;
    this.startLineIx = pos.lineIx;
    for (const noteId of app.selectedNoteIDs.values()) {
      this.originalPosBeatsByNoteId.set(noteId, app.notes.getNote(noteId)!.startPoint);
    }
  }

  public onMove(pos: GridPos) {
    const app = this.app;
    const xDiffBeats = app.pxToBeats(pos.xPx - this.startXPx);

    // Move all notes horizontally before attempting any vertical movement, rightmost-first when
    // dragging right (leftmost-first when dragging left) so selected notes vacate space for their
    // selected neighbors instead of clamping against a group member that hasn't moved yet.
    const ordered = [...this.originalPosBeatsByNoteId.entries()].sort(
      (a, b) => (a[1] - b[1]) * (xDiffBeats < 0 ? 1 : -1)
    );
    for (const [noteId, originalPosBeats] of ordered) {
      const newDesiredStartPosBeats = Math.max(
        app.parentInstance.snapBeat(originalPosBeats + xDiffBeats),
        0
      );
      app.notes.moveNoteHorizontal(noteId, newDesiredStartPosBeats);
    }
    app.onNotesChanged();

    const lineDiff = pos.lineIx - this.startLineIx;
    if (lineDiff === 0) {
      return;
    }

    const selectedNoteIds = [...app.selectedNoteIDs.values()];
    const ungatedLineIndices: Set<number> = new Set();
    const gatedLineIndicesToVelocity: Map<number, number> = new Map();
    for (const noteId of selectedNoteIds) {
      const note = app.notes.getNote(noteId);
      if (!note) {
        continue;
      }
      const lineIx = app.notes.getLineIx(noteId)!;

      ungatedLineIndices.add(lineIx);
      const newLineIndex = lineIx + lineDiff;
      gatedLineIndicesToVelocity.set(
        newLineIndex,
        Math.max(gatedLineIndicesToVelocity.get(newLineIndex) ?? 0, note.velocity)
      );
      if (newLineIndex < 0 || newLineIndex >= app.notes.lineCount) {
        return;
      }
      // exclude the selected notes themselves: they all shift by `lineDiff`, so they can never
      // collide with each other, but they'd otherwise register as occupying their soon-vacated lines
      if (
        !app.notes.checkCanAddNoteExcluding(
          newLineIndex,
          note.startPoint,
          note.length,
          app.selectedNoteIDs
        )
      ) {
        return;
      }
    }
    this.startLineIx = pos.lineIx;

    for (const lineIx of ungatedLineIndices) {
      app.ungate(lineIx);
    }
    for (const [lineIx, velocity] of gatedLineIndicesToVelocity) {
      app.gate(lineIx, velocity);
    }

    // move in order of line index so notes don't collide with each other as they migrate
    selectedNoteIds.sort((a, b) => {
      const diff = app.notes.getLineIx(a)! - app.notes.getLineIx(b)!;
      return diff * (lineDiff > 0 ? -1 : 1);
    });
    for (const noteId of selectedNoteIds) {
      app.notes.moveNoteToLine(noteId, app.notes.getLineIx(noteId)! + lineDiff);
    }
    app.onNotesChanged();
  }

  public onUp() {}
}

class NoteCreationSession implements DragSession {
  private app: MIDIEditorUIInstance;
  private lineIx: number;
  private originalPosBeats: number;
  private startPositionBeats: number;
  private endPositionBeats: number;
  private id: number | null = null;

  constructor(app: MIDIEditorUIInstance, lineIx: number, posBeats: number) {
    this.app = app;
    this.lineIx = lineIx;
    this.originalPosBeats = posBeats;
    this.startPositionBeats = posBeats;
    this.endPositionBeats = posBeats;
  }

  public onMove(pos: GridPos) {
    const app = this.app;
    const newPosBeats = app.parentInstance.snapBeat(Math.max(pos.beat, 0));
    let [newStartPosBeats, newEndPosBeats] = [
      Math.min(newPosBeats, this.originalPosBeats),
      Math.max(newPosBeats, this.originalPosBeats),
    ];
    if (R.isNil(this.id)) {
      const free = app.notes.freeRangeAt(this.lineIx, this.originalPosBeats);
      newStartPosBeats = Math.max(newStartPosBeats, free.start);
      newEndPosBeats = Math.min(newEndPosBeats, free.end);
    }
    const noteLengthPx = app.beatsToPx(newEndPosBeats - newStartPosBeats);
    if (!R.isNil(this.id) && noteLengthPx < conf.MIN_DRAWING_NOTE_WIDTH_PX) {
      // end is too close to the start; delete the note that we had created here
      app.deleteNote(this.id);
      this.id = null;
    } else if (!R.isNil(this.id)) {
      if (newStartPosBeats !== this.startPositionBeats) {
        newStartPosBeats = app.resizeNoteHorizontalStart(this.id, newStartPosBeats);
      } else if (newEndPosBeats !== this.endPositionBeats) {
        newEndPosBeats = app.resizeNoteHorizontalEnd(this.id, newEndPosBeats);
      }
    }

    this.startPositionBeats = newStartPosBeats;
    this.endPositionBeats = newEndPosBeats;

    if (R.isNil(this.id) && noteLengthPx >= conf.MIN_DRAWING_NOTE_WIDTH_PX) {
      this.id = app.addNote(
        this.lineIx,
        newStartPosBeats,
        newEndPosBeats - newStartPosBeats,
        this.app.managedInst.lastSetNoteVelocity
      );
    }
  }

  public onUp() {}
}

export default class InteractionManager {
  private app: MIDIEditorUIInstance;
  private canvas: HTMLCanvasElement;
  private layers: HitLayer[];
  private activeSession: DragSession | null = null;
  private activePointerId = -1;

  constructor(app: MIDIEditorUIInstance) {
    this.app = app;
    this.canvas = app.app.renderer.view as HTMLCanvasElement;
    this.layers = [
      this.panLayer,
      this.selectionBoxLayer,
      this.velocityHandleLayer,
      this.noteEdgeLayer,
      this.noteBodyLayer,
      this.emptyGridLayer,
    ];

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.endSession);
    this.canvas.addEventListener('pointercancel', this.endSession);
  }

  private gridPosFromEvent(evt: PointerEvent): GridPos {
    const xPx = evt.offsetX - conf.PIANO_KEYBOARD_WIDTH;
    const yPx = evt.offsetY - conf.CURSOR_GUTTER_HEIGHT;
    return {
      xPx,
      yPx,
      beat: this.app.pxToBeats(xPx) + this.app.parentInstance.baseView.scrollHorizontalBeats,
      lineIx: this.app.computeLineIndex(yPx),
    };
  }

  /**
   * Returns the note whose visual extent (including the 1px left slop occupied by the left drag
   * handle) contains the given position.
   */
  private hitTestNote(pos: GridPos): Note | undefined {
    return this.app.notes.noteContaining(pos.lineIx, pos.beat + this.app.pxToBeats(1));
  }

  public noteAtCanvasPos(offsetX: number, offsetY: number): Note | undefined {
    if (offsetX < conf.PIANO_KEYBOARD_WIDTH || offsetY < conf.CURSOR_GUTTER_HEIGHT) {
      return undefined;
    }
    const xPx = offsetX - conf.PIANO_KEYBOARD_WIDTH;
    const yPx = offsetY - conf.CURSOR_GUTTER_HEIGHT;
    return this.hitTestNote({
      xPx,
      yPx,
      beat: this.app.pxToBeats(xPx) + this.app.parentInstance.baseView.scrollHorizontalBeats,
      lineIx: this.app.computeLineIndex(yPx),
    });
  }

  private isInVelocityHandleZone(note: Note, pos: GridPos): boolean {
    if (!this.app.parentInstance.uiManager.velocityDisplayEnabled) {
      return false;
    }
    const inLineY = pos.yPx + this.app.view.scrollVerticalPx - pos.lineIx * conf.LINE_HEIGHT;
    if (inLineY < conf.LINE_HEIGHT - 5.5) {
      return false;
    }
    const localX = noteLocalXPx(this.app, note, pos);
    const barWidth = Math.floor(((this.app.beatsToPx(note.length) - 2) * note.velocity) / 127);
    return localX >= 2 + barWidth && localX <= 7 + barWidth;
  }

  private edgeZoneSide(note: Note, pos: GridPos): NoteDragHandleSide | null {
    const noteWidthPx = this.app.beatsToPx(note.length);
    const handleWidthPx = computeHandleWidthPx(noteWidthPx);
    const localX = noteLocalXPx(this.app, note, pos);
    if (localX <= handleWidthPx) {
      return NoteDragHandleSide.Left;
    }
    if (localX >= noteWidthPx - handleWidthPx) {
      return NoteDragHandleSide.Right;
    }
    return null;
  }

  private panLayer: HitLayer = {
    hitTest: (pos, evt) => (evt.button === 1 ? new PanSession(this.app, pos) : null),
  };

  private selectionBoxLayer: HitLayer = {
    hitTest: (pos, evt) =>
      evt.button === 0 && this.app.selectionBoxButtonDown
        ? new SelectionBoxSession(this.app, pos)
        : null,
  };

  private velocityHandleLayer: HitLayer = {
    hitTest: (pos, evt) => {
      if (evt.button !== 0) {
        return null;
      }
      const note = this.hitTestNote(pos);
      if (!note || !this.isInVelocityHandleZone(note, pos)) {
        return null;
      }
      return new VelocityDragSession(this.app, note, pos);
    },
    hoverCursor: pos => {
      const note = this.hitTestNote(pos);
      return note && this.isInVelocityHandleZone(note, pos) ? 'ew-resize' : null;
    },
  };

  private noteEdgeLayer: HitLayer = {
    hitTest: (pos, evt) => {
      if (evt.button !== 0) {
        return null;
      }
      const note = this.hitTestNote(pos);
      if (!note) {
        return null;
      }
      const side = this.edgeZoneSide(note, pos);
      if (side === null) {
        return null;
      }

      if (!this.app.selectedNoteIDs.has(note.id)) {
        this.app.selectNote(note.id);
      }
      return new ResizeSession(this.app, pos, side);
    },
    hoverCursor: pos => {
      const note = this.hitTestNote(pos);
      return note && this.edgeZoneSide(note, pos) !== null ? 'ew-resize' : null;
    },
  };

  private noteBodyLayer: HitLayer = {
    hitTest: (pos, evt) => {
      const note = this.hitTestNote(pos);
      if (!note) {
        return null;
      }

      if (evt.button === 2) {
        this.app.deleteNote(note.id);
        return NOOP_SESSION;
      }
      if (evt.button !== 0) {
        return null;
      }

      if (this.app.selectedNoteIDs.has(note.id)) {
        if (this.app.multiSelectEnabled) {
          this.app.deselectNote(note.id);
        }
      } else {
        this.app.selectNote(note.id);
      }

      this.app.gateAllSelectedNotes();
      this.app.addMouseUpCB(() => this.app.ungateAllSelectedNotes());

      return new NoteDragSession(this.app, pos);
    },
    hoverCursor: pos => (this.hitTestNote(pos) ? 'pointer' : null),
  };

  private emptyGridLayer: HitLayer = {
    hitTest: (pos, evt) => {
      if (evt.button !== 0 || pos.lineIx < 0 || pos.lineIx >= this.app.notes.lineCount) {
        return null;
      }

      const lineIx = pos.lineIx;
      const posBeats = this.app.parentInstance.snapBeat(Math.max(pos.beat, 0));
      this.app.gate(lineIx, 90);
      this.app.addMouseUpCB(() => this.app.ungate(lineIx));
      if (!this.app.notes.checkCanAddNote(lineIx, posBeats, 0)) {
        return NOOP_SESSION;
      }

      this.app.deselectAllNotes();
      return new NoteCreationSession(this.app, lineIx, posBeats);
    },
  };

  private handlePointerDown = (evt: PointerEvent) => {
    if (
      this.activeSession ||
      evt.offsetX < conf.PIANO_KEYBOARD_WIDTH ||
      evt.offsetY < conf.CURSOR_GUTTER_HEIGHT
    ) {
      return;
    }

    const pos = this.gridPosFromEvent(evt);
    for (const layer of this.layers) {
      const session = layer.hitTest(pos, evt);
      if (session) {
        this.activeSession = session;
        this.activePointerId = evt.pointerId;
        try {
          this.canvas.setPointerCapture(evt.pointerId);
        } catch (_err) {
          // pointer may already be gone (e.g. pen lifted); session will end via pointerup/cancel
        }
        return;
      }
    }
  };

  private updateHoverCursor = (evt: PointerEvent) => {
    if (evt.offsetX < conf.PIANO_KEYBOARD_WIDTH || evt.offsetY < conf.CURSOR_GUTTER_HEIGHT) {
      return;
    }
    const pos = this.gridPosFromEvent(evt);
    let cursor = 'default';
    for (const layer of this.layers) {
      const layerCursor = layer.hoverCursor?.(pos);
      if (layerCursor) {
        cursor = layerCursor;
        break;
      }
    }
    // `stage.cursor` is what PIXI's event system re-applies on its own pointermoves (the grid
    // region's hit test resolves to the stage); `setCursor` applies it immediately so gesture
    // ends don't leave a stale cursor until the next move
    this.app.app.stage.cursor = cursor;
    this.app.app.renderer.events.setCursor(cursor);
  };

  private handlePointerMove = (evt: PointerEvent) => {
    if (this.activeSession) {
      if (evt.pointerId === this.activePointerId) {
        this.activeSession.onMove(this.gridPosFromEvent(evt), evt);
      }
      return;
    }

    this.updateHoverCursor(evt);
  };

  private endSession = (evt: PointerEvent) => {
    if (!this.activeSession || evt.pointerId !== this.activePointerId) {
      return;
    }

    const session = this.activeSession;
    this.activeSession = null;
    this.activePointerId = -1;
    try {
      this.canvas.releasePointerCapture(evt.pointerId);
    } catch (_err) {
      // already released
    }
    session.onUp(this.gridPosFromEvent(evt));
    this.app.flushMouseUpCBs();
    this.updateHoverCursor(evt);
  };

  public destroy() {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.endSession);
    this.canvas.removeEventListener('pointercancel', this.endSession);
  }
}
