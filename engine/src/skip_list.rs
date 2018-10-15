//! Defines a skip list data structure that is used to hold the intervals occupied by all of the
//! notes in all of the lines.  It supports functions for finding the preceeding and following
//! note for a given beat, handling cases where the query is within an existing note or unbounded
//! one or both sides.
//!
//! The time complexity for insertion, removal, and querying is `O(log n)`.

extern crate test;
use std::marker::PhantomData;
use std::mem;
use std::num::NonZeroU32;
use std::ops::{Deref, DerefMut, Index};

use rand::prelude::*;
use rand_pcg::Pcg32;
use slab::Slab;

use super::{NoteBox, NOTE_BOXES, NOTE_SKIPLIST_NODES, RNG};

const NOTE_SKIP_LIST_LEVELS: usize = 3;

#[inline(always)]
fn notes() -> &'static mut Slab<NoteBox> {
    unsafe { &mut *NOTE_BOXES }
}

#[inline(always)]
fn nodes() -> &'static mut Slab<NoteSkipListNode> {
    unsafe { &mut *NOTE_SKIPLIST_NODES }
}

#[derive(Clone, Copy)]
pub struct SlabKey<T>(NonZeroU32, PhantomData<T>);

impl<T> SlabKey<T> {
    #[inline]
    pub fn key(&self) -> usize {
        self.0.get() as usize
    }
}

impl<T> From<usize> for SlabKey<T> {
    #[inline]
    fn from(key: usize) -> Self {
        SlabKey(
            unsafe { NonZeroU32::new_unchecked(key as u32) },
            PhantomData,
        )
    }
}

impl Deref for SlabKey<NoteBox> {
    type Target = NoteBox;

    fn deref(&self) -> &NoteBox {
        &notes()[*self]
    }
}

impl Deref for SlabKey<NoteSkipListNode> {
    type Target = NoteSkipListNode;

    fn deref(&self) -> &NoteSkipListNode {
        &nodes()[self.clone()]
    }
}

impl DerefMut for SlabKey<NoteBox> {
    fn deref_mut(&mut self) -> &mut NoteBox {
        &mut notes()[self.key()]
    }
}

impl DerefMut for SlabKey<NoteSkipListNode> {
    fn deref_mut(&mut self) -> &mut NoteSkipListNode {
        &mut nodes()[self.key()]
    }
}

#[derive(Clone)]
pub struct NoteSkipListNode {
    val_slot_key: SlabKey<NoteBox>,
    /// Contains links to the next node in the sequence as well as all shortcuts that exist for
    /// that node.  In the case that there are no shortcuts available
    links: [Option<SlabKey<NoteSkipListNode>>; NOTE_SKIP_LIST_LEVELS],
}

impl Index<SlabKey<NoteSkipListNode>> for Slab<NoteSkipListNode> {
    type Output = NoteSkipListNode;

    #[inline]
    fn index(&self, index: SlabKey<NoteSkipListNode>) -> &NoteSkipListNode {
        &self.get(index.key()).unwrap()
    }
}

impl Index<SlabKey<NoteBox>> for Slab<NoteBox> {
    type Output = NoteBox;

    #[inline]
    fn index(&self, index: SlabKey<NoteBox>) -> &NoteBox {
        &self.get(index.key()).unwrap()
    }
}

/// Skip list levels are taken via a geometric distribution - each level has 50% less of a chance
/// to have a shortcut than the one below it.
#[inline]
fn get_skip_list_level() -> usize {
    let rng: usize = unsafe { (*RNG).gen() };
    rng & ((1 << NOTE_SKIP_LIST_LEVELS) - 1)
}

#[inline]
fn blank_shortcuts<T>() -> [Option<T>; NOTE_SKIP_LIST_LEVELS] {
    let mut shortcuts: [Option<T>; NOTE_SKIP_LIST_LEVELS] = unsafe { mem::uninitialized() };
    for link in shortcuts.iter_mut() {
        *link = None;
    }
    shortcuts
}

impl NoteSkipListNode {
    #[inline]
    pub fn contains_beat(&self, beat: f32) -> bool {
        let note: NoteBox = notes()[self.val_slot_key];
        note.start_beat <= beat && note.end_beat >= beat
    }
}

impl NoteSkipListNode {
    /// Returns the slot index of the last node that has a value less than that of the target
    /// value.  If `target_val` is less than all other values in the collection, then `None`
    /// is returned.
    pub fn search<'a>(
        &'a mut self,
        target_val: f32,
        self_key: Option<SlabKey<NoteSkipListNode>>,
        levels: &mut [Option<SlabKey<NoteSkipListNode>>; NOTE_SKIP_LIST_LEVELS],
    ) {
        // Starting with the top level and working down, check if the value behind the shortcut is
        // higher or lower than the current value.
        let mut link_level = NOTE_SKIP_LIST_LEVELS - 1;
        loop {
            if let Some(shortcut_node_slot_key) = &mut self.links[link_level] {
                let shortcut_node: &mut NoteSkipListNode = &mut *(shortcut_node_slot_key.clone());

                // if this shortcut value is still smaller, take the shortcut and continue searching.
                if shortcut_node.val_slot_key.end_beat < target_val {
                    // Record the preceeding index for all levels for which we have a pointer
                    for i in 0..link_level {
                        levels[i] = self_key.clone()
                    }
                    return shortcut_node.search(
                        target_val,
                        Some(shortcut_node_slot_key.clone()),
                        levels,
                    );
                }
            }

            if link_level == 0 {
                return;
            }
            link_level -= 1;
        }
    }
}

#[derive(Clone)]
struct NoteSkipList {
    head_key: Option<SlabKey<NoteSkipListNode>>,
}

impl NoteSkipList {
    pub fn new() -> Self {
        let mut nodes = Slab::new();
        let mut notes = Slab::new();
        // insert dummy values to ensure that we never have anything at index 0 and our `NonZero`
        // assumptions remain true
        let note_slot_key: SlabKey<NoteBox> = notes
            .insert(NoteBox {
                start_beat: 0.0,
                end_beat: 0.0,
            })
            .into();
        assert_eq!(note_slot_key.key(), 0);
        let placeholder_node_key = nodes.insert(NoteSkipListNode {
            val_slot_key: note_slot_key,
            links: blank_shortcuts(),
        });
        assert_eq!(placeholder_node_key, 0);

        NoteSkipList { head_key: None }
    }

    #[inline(always)]
    pub fn head<'a>(&'a self) -> Option<&'a NoteSkipListNode> {
        self.head_key.as_ref().map(|k| &**k)
    }

    #[inline(always)]
    pub fn head_mut<'a>(&'a mut self) -> Option<&'a mut NoteSkipListNode> {
        self.head_key.as_mut().map(|k| &mut **k)
    }

    pub fn insert(&mut self, note: NoteBox) {
        let new_node = NoteSkipListNode {
            val_slot_key: notes().insert(note).into(),
            links: blank_shortcuts(),
        };
        let new_node_key: SlabKey<NoteSkipListNode> = nodes().insert(new_node).into();
        let new_node: &mut NoteSkipListNode = &mut *(new_node_key.clone());

        if self.head_key.is_none() {
            self.head_key = Some(new_node_key);
            return;
        }

        let mut head_key = self.head_key.as_mut().unwrap().clone();
        let head: &mut NoteSkipListNode = &mut *head_key;
        let mut preceeding_links = blank_shortcuts();
        head.search(note.start_beat, None, &mut preceeding_links);
        let level = get_skip_list_level();
        if preceeding_links[NOTE_SKIP_LIST_LEVELS - 1].is_some() {
            // Insert the new node between this node and its child (if it has one).
            // For levels through the generated level, we link the inserted node to where the
            // previous node was linking before and link the to the new node from it.

            for i in 0..level {
                let preceeding_node_for_level = &mut **preceeding_links[i].as_mut().unwrap();
                new_node.links[i] = preceeding_node_for_level.links[i].clone();
                preceeding_node_for_level.links[i] = Some(new_node_key.clone());
            }
        // For levels after the generated level, we take no action.  We let the existing
        // links stay as they are and leave the new nodes' blank.
        } else {
            // The new note is the smallest one in the list, so insert it before the head.
            // Link to the old head for levels up to the one we generated
            for i in 0..level {
                new_node.links[i] = self.head_key.clone();
            }
            // Steal links from the old head for all other levels above that
            for i in level..NOTE_SKIP_LIST_LEVELS {
                new_node.links[i] = head.links[i].clone();
            }

            self.head_key = Some(new_node_key);
        }
    }

    /// Removes any note box that contains the given beat.
    pub fn remove(&mut self, beat: f32) {
        unimplemented!() // TODO
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
        unimplemented!() // TODO
    }
}

#[bench]
fn bench_add_two(b: &mut test::Bencher) {
    unsafe { RNG = Box::into_raw(box Pcg32::from_seed(mem::transmute(0u128))) };
    b.iter(get_skip_list_level)
}

/// Make sure that our `SlabKey` abstraction really is zero-cost in terms of memory for options,
/// meaning that the null pointer optimization did indeed apply.
#[test]
fn slab_key_size() {
    use std::mem;
    let (s1, s2, s3) = (
        mem::size_of::<NonZeroU32>(),
        mem::size_of::<SlabKey<(u64, u64)>>(),
        mem::size_of::<Option<SlabKey<(u64, u64)>>>(),
    );
    assert_eq!(s1, s2);
    assert_eq!(s2, s3);
}
