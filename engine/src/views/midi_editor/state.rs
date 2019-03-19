use super::prelude::*;

pub unsafe fn init_state() {
    skip_list::SKIP_LIST_NODE_DEBUG_POINTERS = Box::into_raw(box skip_list::blank_shortcuts());
}
