use super::ViewContext;

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
    pub fn get_active_view(&self) -> &dyn ViewContext {
        &*self.contexts[self.active_context_ix].context
    }

    pub fn get_active_view_mut(&mut self) -> &mut dyn ViewContext {
        &mut *self.contexts[self.active_context_ix].context
    }

    pub fn save_all(&mut self) {
        for entry in &self.contexts {
            if !entry.touched {
                continue;
            }

            let serialized = entry.context.save();
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
