import { UnreachableException } from 'ameo-utils';

import * as conf from '../conf';
import * as PIXI from 'src/controls/pixi';
import { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import NoteLine from 'src/midiEditor/NoteLine';

export class NoteBox {
  public line: NoteLine;
  public note: Note;
  public graphics: PIXI.Graphics;
  private isSelected = false;
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
    this.line.container.removeChild(this.graphics);
    this.graphics.destroy();
  }
}
