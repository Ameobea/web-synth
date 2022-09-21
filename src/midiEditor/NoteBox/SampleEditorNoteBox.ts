import * as PIXI from 'src/controls/pixi';
import * as conf from 'src/midiEditor/conf';
import type { Note } from 'src/midiEditor/MIDIEditorUIInstance';
import { NoteBox } from 'src/midiEditor/NoteBox/NoteBox';
import type NoteLine from 'src/midiEditor/NoteLine';

class SampleEditorNoteBoxLabel {
  private noteBox: NoteBox;
  private text: PIXI.Text;
  private background: PIXI.Graphics;

  constructor(noteBox: NoteBox, labelText: string, widthPx: number) {
    this.noteBox = noteBox;
    this.text = new PIXI.Text(labelText, {
      fontFamily: 'PT Sans',
      fontSize: conf.SAMPLE_EDITOR_LABEL_FONT_SIZE,
      fill: conf.SAMPLE_EDITOR_LABEL_TEXT_COLOR,
      align: 'left',
    });
    this.background = new PIXI.Graphics()
      .beginFill(conf.SAMPLE_EDITOR_LABEL_BACKGROUND_COLOR)
      .lineStyle(1, conf.SAMPLE_EDITOR_LABEL_BORDER_COLOR)
      .drawRect(0, 0, widthPx, conf.SAMPLE_EDITOR_LABEL_HEIGHT);

    this.background.addChild(this.text);
    noteBox.graphics.addChild(this.background);
  }

  public destroy() {
    this.noteBox.graphics.removeChild(this.background);
    this.background.removeChild(this.text);
    this.text.destroy();
    this.background.destroy();
  }
}

export default class SampleEditorNoteBox extends NoteBox {
  constructor(line: NoteLine, note: Note) {
    super(line, note);
  }

  private lastLabelWidthPx = 0;
  private label: SampleEditorNoteBoxLabel | undefined;

  public render() {
    super.render();

    const widthPx = this.line.app.beatsToPx(this.note.length) - 1;
    const labelWidthPx = widthPx - 8;

    // Perf optimization to avoid re-rendering the label if not necessary
    if (labelWidthPx === this.lastLabelWidthPx) {
      return;
    }
    this.lastLabelWidthPx = labelWidthPx;

    if (labelWidthPx >= 20) {
      this.label?.destroy();
      this.label = new SampleEditorNoteBoxLabel(this, 'TODO TODO TODO', labelWidthPx);
    } else {
      this.label?.destroy();
      this.label = undefined;
    }
  }
}
