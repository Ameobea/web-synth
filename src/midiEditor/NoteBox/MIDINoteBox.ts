import type { FederatedPointerEvent, FederatedWheelEvent } from '@pixi/events';

import * as PIXI from 'src/controls/pixi';
import type { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import { NoteBox } from 'src/midiEditor/NoteBox/NoteBox';
import type NoteLine from 'src/midiEditor/NoteLine';
import * as conf from '../conf';
import { clamp } from 'src/util';

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
    g.beginFill(conf.NOTE_DRAG_HANDLE_COLOR, 0.2);
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

class NoteVelocityDisplay {
  private parentNote: NoteBox;
  private graphics: PIXI.Graphics;
  private dragHandle: PIXI.Graphics;
  private dragStartX: number = 0;
  private initialVelocity: number = 0;

  constructor(parentNote: NoteBox) {
    this.parentNote = parentNote;
    this.graphics = this.buildInitialGraphics();
    this.dragHandle = this.buildDragHandle();
  }

  private buildInitialGraphics(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    this.parentNote.graphics.addChild(g);
    return g;
  }

  private buildDragHandle(): PIXI.Graphics {
    const g = new PIXI.Graphics();
    this.parentNote.graphics.addChild(g);
    g.interactive = true;
    g.cursor = 'ew-resize';
    g.on('pointerdown', this.onDragStart);
    return g;
  }

  private onDragStart = (evt: FederatedPointerEvent) => {
    if (evt.button !== 0) {
      return;
    }

    evt.stopPropagation();
    this.dragStartX = evt.global.x;
    this.initialVelocity = this.parentNote.note.velocity ?? 90;
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
  };

  private onDragMove = (evt: PointerEvent) => {
    const noteWidth = this.parentNote.getWidthPx();
    const effectiveWidth = noteWidth - 2;
    const initialBarWidth = Math.floor((effectiveWidth * this.initialVelocity) / 127);
    const delta = evt.clientX - this.dragStartX;
    const newBarWidth = clamp(0, effectiveWidth, initialBarWidth + delta);
    const newVelocity = clamp(0, 127, Math.floor((newBarWidth * 127) / effectiveWidth));
    this.parentNote.line.app.setNoteVelocity(this.parentNote.note.id, newVelocity);
  };

  private onDragEnd = (_evt: PointerEvent) => {
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
  };

  public render() {
    const noteWidth = this.parentNote.getWidthPx();
    const velocity = this.parentNote.note.velocity ?? 90;
    const barWidth = Math.floor(((noteWidth - 2) * velocity) / 127);
    const height = clamp(4, conf.LINE_HEIGHT, Math.floor(conf.LINE_HEIGHT / 3));
    this.graphics.clear();
    this.graphics.beginFill(conf.NOTE_VELOCITY_BAR_COLOR);
    this.graphics.drawRect(2, conf.LINE_HEIGHT - height - 0.5, barWidth, height);
    this.graphics.endFill();

    // drag handle
    const handleWidth = 5;
    const handleX = 2 + barWidth;
    const handleY = conf.LINE_HEIGHT - height - 0.5;
    this.dragHandle.clear();
    this.dragHandle.beginFill(conf.NOTE_VELOCITY_HANDLE_COLOR);
    this.dragHandle.drawRect(handleX, handleY, handleWidth, height);
    this.dragHandle.endFill();
  }

  public destroy() {
    this.parentNote.graphics.removeChild(this.graphics);
    this.graphics.destroy();
    this.parentNote.graphics.removeChild(this.dragHandle);
    this.dragHandle.destroy();
  }
}

export default class MIDINoteBox extends NoteBox {
  public leftDragHandle: NoteDragHandle;
  public rightDragHandle: NoteDragHandle;
  private velocityDisplay: NoteVelocityDisplay | null = null;

  constructor(line: NoteLine, note: Note, velocityDisplayEnabled: boolean) {
    super(line, note, velocityDisplayEnabled);

    this.graphics.on('wheelcapture', this.handleWheel);

    if (velocityDisplayEnabled) {
      this.velocityDisplay = new NoteVelocityDisplay(this);
      this.velocityDisplay.render();
    }

    this.leftDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Left);
    this.rightDragHandle = new NoteDragHandle(this, NoteDragHandleSide.Right);
  }

  private handleWheel = (evt: FederatedWheelEvent) => {
    if (!this.velocityDisplay) {
      return;
    }

    evt.preventDefault();
    const delta = evt.deltaY;
    const velocity = this.note.velocity ?? 90;
    const newVelocity = clamp(0, 127, velocity - Math.sign(delta));
    // TODO: This should be applied to all selected notes instead of just this note
    this.line.app.setNoteVelocity(this.note.id, newVelocity);
  };

  public setVelocityDisplayEnabled(enabled: boolean) {
    if (enabled && !this.velocityDisplay) {
      this.velocityDisplay = new NoteVelocityDisplay(this);
    } else if (!enabled && this.velocityDisplay) {
      this.velocityDisplay.destroy();
      this.velocityDisplay = null;
    }

    this.render();
  }

  public render() {
    super.render();

    this.leftDragHandle.render();
    this.rightDragHandle.render();
    this.velocityDisplay?.render();
  }

  public destory() {
    super.destroy();

    this.leftDragHandle.destroy();
    this.rightDragHandle.destroy();
  }
}
