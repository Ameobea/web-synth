//! Defines a skip list data structure that is used to hold the intervals occupied by all of the
//! notes in all of the lines.  It supports functions for finding the preceeding and following
//! note for a given beat, handling cases where the query is within an existing note or unbounded
//! one or both sides.
//!
//! The time complexity for insertion, removal, and querying is `O(log n)`.

extern crate test;
use std::mem;
use std::num::NonZeroU32;

use rand::prelude::*;
use rand_pcg::Pcg32;
use slab::Slab;

use super::{NoteBox, RNG};

const NOTE_SKIP_LIST_LEVELS: usize = 3;

/// Skip list levels are taken via a geometric distribution - each level has 50% less of a chance
/// to have a shortcut than the one below it.
fn get_skip_list_level() -> usize {
    let rng: usize = unsafe { (*RNG).gen() };
    rng & ((1 << NOTE_SKIP_LIST_LEVELS) - 1)
}

#[derive(Clone)]
struct NoteSkipListNode {
    val_slot_key: usize,
    /// Contains links to the next node in the sequence as well as all shortcuts that exist for
    /// that node.  In the case that there are no shortcuts available
    links: [Option<NonZeroU32>; NOTE_SKIP_LIST_LEVELS],
}

impl NoteSkipListNode {
    /// Returns the slot index of the first node that has a value greater than that of the target
    /// value.  If `traget_val` is greater than all other values in the collection, then `None`
    /// is returned.
    pub fn search(
        &self,
        nodes: &Slab<NoteSkipListNode>,
        notes: &Slab<NoteBox>,
        prev_node_slot_key: usize,
        target_val: f32,
    ) -> Option<usize> {
        // Starting with the top level and working down, check if the value behind the shortcut is
        // higher or lower than the current value.
        let mut link_level = NOTE_SKIP_LIST_LEVELS - 1;
        loop {
            if let Some(shortcut_node_slot_key) = self.links[link_level] {
                let shortcut_node_slot_key = shortcut_node_slot_key.get() as usize;
                let shortcut_node = nodes[shortcut_node_slot_key];
                let shortcut_val = notes[shortcut_node.val_slot_key];

                // if this shortcut value is still smaller, take the shortcut and continue searching.
                if shortcut_val.end_beat < target_val {
                    return shortcut_node.search(nodes, notes, shortcut_node_slot_key, target_val);
                }
            }

            if link_level == 0 {
                if self.links[0].is_none() {
                    return None;
                } else {
                    return prev_node_slot_key;
                }
            }
            link_level -= 1;
        }
    }
}

#[derive(Clone)]
struct NoteSkipList {
    head_key: Option<NonZeroU32>,
    nodes: Slab<NoteSkipListNode>,
    notes: Slab<NoteBox>,
}

impl NoteSkipList {
    pub fn new() -> Self {
        let mut nodes = Slab::new();
        let mut notes = Slab::new();
        // insert dummy values to ensure that we never have anything at index 0 and our `NonZero`
        // assumptions remain true
        let note_slot_key = notes.insert(NoteBox {
            start_beat: 0.0,
            end_beat: 0.0,
        });
        assert_eq!(note_slot_key, 0);
        let placeholder_node_key = nodes.insert(NoteSkipListNode {
            val_slot_key: note_slot_key,
            links: [None; NOTE_SKIP_LIST_LEVELS],
        });
        assert_eq!(placeholder_node_key, 0);

        NoteSkipList {
            head_key: None,
            nodes: Slab::new(),
            notes: Slab::new(),
        }
    }

    pub fn head<'a>(&'a self) -> Option<&'a NoteSkipListNode> {
        let head_key = self.head_key?;
        self.nodes.get(head_key.get() as usize)
    }

    pub fn head_mut<'a>(&'a mut self) -> Option<&'a mut NoteSkipListNode> {
        let head_key = self.head_key?;
        self.nodes.get_mut(head_key.get() as usize)
    }

    pub fn insert(&mut self, note: NoteBox) {
        let new_node = NoteSkipListNode {
            val_slot_key: self.notes.insert(note),
            links: [None; NOTE_SKIP_LIST_LEVELS],
        };

        if self.head_key.is_none() {
            self.head_key =
                Some(unsafe { NonZeroU32::new_unchecked(self.nodes.insert(new_node) as u32) });
            return;
        }
    }
}

/// This data structure holds a list of ordered note boxes
pub struct Notes {
    lines: Vec<NoteSkipList>,
}

impl Notes {
    pub fn new(lines: usize) -> Self {
        Notes {
            lines: vec![NoteSkipList::new(); lines],
        }
    }

    fn locate_index(&self, beat: f32) -> Option<(Option<f32>, Option<f32>)> {
        unimplemented!()
    }
}

#[bench]
fn bench_add_two(b: &mut test::Bencher) {
    unsafe { RNG = Box::into_raw(box Pcg32::from_seed(mem::transmute(0u128))) };
    b.iter(|| get_skip_list_level())
}
