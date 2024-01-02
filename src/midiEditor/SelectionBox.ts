import * as PIXI from 'src/controls/pixi';
import type MIDIEditorUIInstance from 'src/midiEditor/MIDIEditorUIInstance';
import * as conf from './conf';

export default class SelectionBox {
  private app: MIDIEditorUIInstance;
  private graphics: PIXI.Graphics;
  private startPoint: PIXI.Point;
  private endPoint: PIXI.Point;

  constructor(app: MIDIEditorUIInstance, startPoint: PIXI.Point) {
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
    const startBeat =
      this.app.pxToBeats(minX) + this.app.parentInstance.baseView.scrollHorizontalBeats;
    const endBeat =
      this.app.pxToBeats(maxX) + this.app.parentInstance.baseView.scrollHorizontalBeats;
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
