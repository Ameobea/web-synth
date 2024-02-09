use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const ACTIVE_VIEW_HISTORY_LEN: usize = 20;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub(crate) struct ActiveView {
  pub subgraph_id: Uuid,
  pub vc_id: Uuid,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub(crate) struct ActiveViewHistory {
  pub(crate) history: VecDeque<ActiveView>,
  /// Points to one past the last element in the history
  pub(crate) index: usize,
}

impl Default for ActiveViewHistory {
  fn default() -> Self {
    Self {
      history: VecDeque::with_capacity(ACTIVE_VIEW_HISTORY_LEN),
      index: 0,
    }
  }
}

impl ActiveViewHistory {
  pub fn set_active_view(&mut self, subgraph_id: Uuid, vc_id: Uuid) {
    self.history.truncate(self.index);
    self.history.push_back(ActiveView { subgraph_id, vc_id });
    self.index += 1;

    if self.history.len() > ACTIVE_VIEW_HISTORY_LEN {
      self.history.pop_front();
      self.index -= 1;
    }
  }

  pub fn undo(&mut self) -> Option<ActiveView> {
    if self.index > 1 {
      self.index -= 1;
      self.history.get(self.index - 1).cloned()
    } else {
      None
    }
  }

  pub fn redo(&mut self) -> Option<ActiveView> {
    if self.index < self.history.len() {
      self.index += 1;
      self.history.get(self.index - 1).cloned()
    } else {
      None
    }
  }

  pub fn clear(&mut self, cur_active_subgraph_id: Uuid, cur_active_vc_id: Uuid) {
    self.history.clear();
    self.index = 0;
    self.set_active_view(cur_active_subgraph_id, cur_active_vc_id);
  }

  pub fn filter(&mut self, cb: impl Fn(&ActiveView) -> bool) {
    let mut i = 0;
    while i < self.history.len() {
      if !cb(&self.history[i]) {
        self.history.remove(i);

        if self.index > i {
          self.index -= 1;
        }
      }

      i += 1;
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_active_view_history() {
    let mut history = ActiveViewHistory::default();
    assert_eq!(history.history.len(), 0);
    assert_eq!(history.index, 0);

    history.set_active_view(Uuid::from_bytes([1; 16]), Uuid::nil());
    assert_eq!(history.history.len(), 1);
    assert_eq!(history.index, 1);

    history.set_active_view(Uuid::from_bytes([2; 16]), Uuid::nil());
    assert_eq!(history.history.len(), 2);
    assert_eq!(history.index, 2);

    let view = history.undo().unwrap();
    assert_eq!(history.index, 1);
    assert_eq!(view.subgraph_id, Uuid::from_bytes([1; 16]));

    let view = history.undo();
    assert_eq!(history.index, 1);
    assert!(view.is_none());

    let view = history.undo();
    assert_eq!(history.index, 1);
    assert!(view.is_none());

    let view = history.redo().unwrap();
    assert_eq!(history.index, 2);
    assert_eq!(view.subgraph_id, Uuid::from_bytes([2; 16]));

    let view = history.redo();
    assert_eq!(history.index, 2);
    assert!(view.is_none());
  }

  #[test]
  fn history_filter() {
    let zero = Uuid::from_bytes([0; 16]);
    let one = Uuid::from_bytes([1; 16]);
    let two = Uuid::from_bytes([2; 16]);

    let mut history = ActiveViewHistory::default();

    history.set_active_view(zero, zero);
    history.set_active_view(one, one);
    history.set_active_view(two, two);

    history.filter(|view| view.subgraph_id != one);
    assert_eq!(history.history.len(), 2);

    let view = history.undo().unwrap();
    assert_eq!(view.subgraph_id, zero);

    let view = history.undo();
    assert!(view.is_none());

    let view = history.redo().unwrap();
    assert_eq!(view.subgraph_id, two);
  }

  #[test]
  fn history_filter_2() {
    let zero = Uuid::from_bytes([0; 16]);
    let one = Uuid::from_bytes([1; 16]);
    let two = Uuid::from_bytes([2; 16]);

    let mut history = ActiveViewHistory::default();

    history.set_active_view(zero, zero);
    history.set_active_view(one, one);

    history.filter(|view| view.subgraph_id != zero);

    history.set_active_view(two, two);

    let view = history.undo().unwrap();
    assert_eq!(view.subgraph_id, one);
  }
}
