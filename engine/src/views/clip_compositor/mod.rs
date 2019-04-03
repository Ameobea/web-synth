use crate::{helpers::grid::prelude::*, view_context::ViewContext};

struct ClipCompositorNoteData {
    pub dom_id: DomId,
    pub note_data_key: usize,
}

impl GridRendererUniqueIdentifier for ClipCompositorNoteData {
    fn get_id(&self) -> DomId { self.dom_id }
}

struct ClipCompositorRenderer;

impl GridRenderer<ClipCompositorNoteData> for ClipCompositorRenderer {}

pub struct ClipCompositorHandler {}

impl Default for ClipCompositorHandler {
    fn default() -> Self { ClipCompositorHandler {} }
}

impl GridHandler<ClipCompositorNoteData, ClipCompositorRenderer> for ClipCompositorHandler {
    fn create_note(
        &mut self,
        _grid_state: &mut GridState<ClipCompositorNoteData>,
        _line_ix: usize,
        _start_beat: f32,
        dom_id: DomId,
    ) -> ClipCompositorNoteData {
        ClipCompositorNoteData {
            dom_id,
            note_data_key: 0, // TODO
        }
    }
}

type ClipCompositorGrid =
    Grid<ClipCompositorNoteData, ClipCompositorRenderer, ClipCompositorHandler>;

pub fn mk_clip_compositor(_config: &str) -> Box<dyn ViewContext> {
    // TODO: Parse the config and use that rather than the constants
    let conf: GridConf = unimplemented!();

    let view_context = ClipCompositorHandler::default();
    let grid: Box<ClipCompositorGrid> = box Grid::new(conf, view_context);

    grid
}
