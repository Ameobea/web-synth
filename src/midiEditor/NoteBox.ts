import { UnreachableException } from 'ameo-utils';
import * as PIXI from 'pixi.js';

import { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import NoteLine from 'src/midiEditor/NoteLine';
import * as conf from './conf';

export enum NoteDragHandleSide {
  Left,
  Right,
}

export class NoteDragHandle {
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
    g.beginFill(0x585858, 0.2);
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

export class NoteBox {
  public line: NoteLine;
  public note: Note;
  public graphics: PIXI.Graphics;
  private isSelected = false;
  public leftDragHandle: NoteDragHandle;
  public rightDragHandle: NoteDragHandle;
  private isCulled = true;

  constructor(line: NoteLine, note: Note) {
    this.line = line;
    this.note = note;
    this.graphics = new PIXI.Graphics();
    this.graphics.interactive = true;
    this.graphics.cursor = 'pointer';
    this.graphics.on('pointerdown', (evt: PIXI.InteractionEvent) => {
      if (evt.data.button === 2) {
        this.line.app.deleteNote(this.note.id);
        return;
      } else if ((evt.data.originalEvent as any).button !== 0) {
        return;
      }

      if (this.line.app.selectedNoteIDs.has(this.note.id)) {
        if (this.line.app.multiSelectEnabled) {
          this.line.app.deselectNote(this.note.id);
        }
      } else {
        this.line.app.selectNote(this.note.id);
      }

      this.line.app.gateAllSelectedNotes();
      this.line.app.addMouseUpCB(() => this.line.app.ungateAllSelectedNotes());

      this.line.app.startDraggingSelectedNotes(evt.data);
    });

    this.leftDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Left);
    this.rightDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Right);

    this.render();
  }

  public render() {
    const startPointPx =
      (this.note.startPoint - this.line.app.view.scrollHorizontalBeats) *
        this.line.app.view.pxPerBeat -
      1;
    const widthPx = this.line.app.beatsToPx(this.note.length) - 1;
    const endPointPx = startPointPx + widthPx;
    // Check if we're entirely off-screen and if so, cull ourselves entirely from the scene
    const isNowCulled = endPointPx < 0 || startPointPx > this.line.app.width;
    if (isNowCulled && !this.isCulled) {
      this.isCulled = isNowCulled;
      this.line.container.removeChild(this.graphics);
      return;
    } else if (!isNowCulled && this.isCulled) {
      this.isCulled = isNowCulled;
      this.line.container.addChild(this.graphics);
    }

    this.graphics.clear();
    this.graphics.lineStyle(1, 0x333333);
    this.graphics.beginFill(this.isSelected ? conf.NOTE_SELECTED_COLOR : conf.NOTE_COLOR);
    this.graphics.drawRect(1, 0, widthPx, conf.LINE_HEIGHT - 1);
    this.graphics.endFill();
    this.graphics.x = startPointPx;

    this.leftDragHandle.render();
    this.rightDragHandle.render();
  }

  public handleDrag(newDesiredStartPos: number) {
    if (!this.line.app.wasm) {
      throw new UnreachableException();
    }

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
