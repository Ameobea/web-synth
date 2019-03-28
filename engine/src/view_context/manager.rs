use super::{super::views::midi_editor::mk_midi_editor, ViewContext};

pub struct ViewContextEntry {
    pub context: Box<dyn ViewContext>,
    /// A flag indicating if this entry has received any actions since it was last saved
    pub touched: bool,
}

impl ViewContextEntry {
    pub fn new(context: Box<dyn ViewContext>) -> Self {
        ViewContextEntry {
            context,
            touched: false,
        }
    }
}

pub struct ViewContextManager {
    pub active_context_ix: usize,
    pub contexts: Vec<ViewContextEntry>,
}

impl Default for ViewContextManager {
    fn default() -> Self {
        ViewContextManager {
            active_context_ix: 0,
            contexts: Vec::new(),
        }
    }
}

impl ViewContextManager {
    /// Adds a `ViewContext` instance to be managed by the `ViewContextManager`
    pub fn add_view(&mut self, view: Box<dyn ViewContext>) {
        self.contexts.push(ViewContextEntry {
            context: view,
            touched: false,
        });
    }

    /// Calls the `init()` function of all managed `ViewContext`s
    pub fn init(&mut self) { self.contexts[self.active_context_ix].context.init(); }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view(&self) -> &dyn ViewContext {
        &*self.contexts[self.active_context_ix].context
    }

    /// Retrieves the active `ViewContextManager`
    pub fn get_active_view_mut(&mut self) -> &mut dyn ViewContext {
        &mut *self.contexts[self.active_context_ix].context
    }

    /// Serializes all managed view contexts and saves them to persistent storage.
    pub fn save_all(&mut self) {
        for entry in &self.contexts {
            if !entry.touched {
                continue;
            }

            let _serialized = entry.context.save();
            // TODO: save to localstorage or something
        }
    }

    pub fn set_active_view(&mut self, view_ix: usize) {
        self.save_all();
        self.get_active_view_mut().cleanup();
        self.active_context_ix = view_ix;
        self.get_active_view_mut().init();
    }
}

pub fn build_view(name: &str, definition: &str) -> Box<dyn ViewContext> {
    match name {
        "midi_editor" => mk_midi_editor(definition),
        _ => unimplemented!(),
    }
}
