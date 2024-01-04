import * as PIXI from 'src/controls/pixi';
import type { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import { NoteBox } from 'src/midiEditor/NoteBox/NoteBox';
import type NoteLine from 'src/midiEditor/NoteLine';
import * as conf from '../conf';
import type { FederatedPointerEvent } from '@pixi/events';

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
    g.on('pointerdown', (evt: FederatedPointerEvent) => {
      if (evt.button !== 0 || this.parentNote.line.app.selectionBoxButtonDown) {
        return;
      }

      const isSelected = this.parentNote.line.app.selectedNoteIDs.has(this.parentNote.note.id);
      if (!isSelected) {
        this.parentNote.line.app.selectNote(this.parentNote.note.id);
      }

      this.parentNote.line.app.startResizingSelectedNotes(evt, this.side);
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
    const newPosBeats = this.parentNote.line.app.parentInstance.snapBeat(
      originalPosBeats + diffBeats
    );
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
    this.graphics.scale.set(this.computeWidth() / 20, 1);
  }

  public destroy() {
    if (this.graphics) {
      this.parentNote.graphics.removeChild(this.graphics);
      this.graphics.destroy();
    }
  }
}

export default class MIDINoteBox extends NoteBox {
  public leftDragHandle: NoteDragHandle;
  public rightDragHandle: NoteDragHandle;

  constructor(line: NoteLine, note: Note) {
    super(line, note);

    this.leftDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Left);
    this.rightDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Right);
  }

  public render() {
    super.render();

    this.leftDragHandle.render();
    this.rightDragHandle.render();
  }

  public destory() {
    super.destroy();

    this.leftDragHandle.destroy();
    this.rightDragHandle.destroy();
  }
}
