//! Defines a skip list data structure that is used to hold the intervals occupied by all of the
//! notes in all of the lines.  It supports functions for finding the preceeding and following
//! note for a given beat, handling cases where the query is within an existing note or unbounded
//! one or both sides.
//!
//! The time complexity for insertion, removal, and querying is `O(log n)`.

extern crate test;
use std::fmt::{self, Debug, Formatter};
use std::marker::PhantomData;
use std::mem;
use std::num::NonZeroU32;
use std::ops::{Deref, DerefMut, Index};
use std::ptr;

use rand::prelude::*;
use slab::Slab;

use super::{nodes, notes, NoteBox, NOTE_SKIP_LIST_LEVELS, RNG};

#[derive(Clone, Copy, PartialEq)]
pub struct SlabKey<T>(NonZeroU32, PhantomData<T>);

impl<T> Debug for SlabKey<T> {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        write!(fmt, "{}", self.key())
    }
}

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
        if cfg!(debug_assertions) {
            &notes()[self.key()]
        } else {
            unsafe { notes().get_unchecked(self.key()) }
        }
    }
}

impl Deref for SlabKey<NoteSkipListNode> {
    type Target = NoteSkipListNode;

    fn deref(&self) -> &NoteSkipListNode {
        if cfg!(debug_assertions) {
            &nodes()[self.key()]
        } else {
            unsafe { nodes().get_unchecked(self.key()) }
        }
    }
}

impl DerefMut for SlabKey<NoteBox> {
    fn deref_mut(&mut self) -> &mut NoteBox {
        if cfg!(debug_assertions) {
            &mut notes()[self.key()]
        } else {
            unsafe { notes().get_unchecked_mut(self.key()) }
        }
    }
}

impl DerefMut for SlabKey<NoteSkipListNode> {
    fn deref_mut(&mut self) -> &mut NoteSkipListNode {
        if cfg!(debug_assertions) {
            &mut nodes()[self.key()]
        } else {
            unsafe { nodes().get_unchecked_mut(self.key()) }
        }
    }
}

#[derive(Clone)]
pub struct NoteSkipListNode {
    pub val_slot_key: SlabKey<NoteBox>,
    /// Contains links to the next node in the sequence as well as all shortcuts that exist for
    /// that node.  In the case that there are no shortcuts available
    pub links: [Option<SlabKey<NoteSkipListNode>>; NOTE_SKIP_LIST_LEVELS],
}

/// When debug-printing a `NoteSkipList`, we aren't able to implement debugging of an individual
/// node as a pure function.  The reason for this that the arrows drawn between the different
/// nodes depend on what nodes previously linked to it, and the distance can be large.
///
/// This data structure holds a pointer to the next node for each of the levels of the skip list,
/// allowing equality to be tested for arrow drawing.
#[thread_local]
pub static mut SKIP_LIST_NODE_DEBUG_POINTERS: *mut [Option<SlabKey<NoteSkipListNode>>;
    NOTE_SKIP_LIST_LEVELS] = ptr::null_mut();

pub fn init_node_dbg_ptrs(head_key: &SlabKey<NoteSkipListNode>) {
    for p in get_debug_ptrs() {
        *p = Some(head_key.clone());
    }
}

fn get_debug_ptrs() -> &'static mut [Option<SlabKey<NoteSkipListNode>>; NOTE_SKIP_LIST_LEVELS] {
    unsafe { &mut *SKIP_LIST_NODE_DEBUG_POINTERS }
}

impl Debug for NoteSkipListNode {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        let debug_ptrs = get_debug_ptrs();
        let next_node = &self.links[0];
        for (level, next_node_for_level) in self.links.iter().enumerate() {
            if next_node_for_level.is_some()
                && debug_ptrs[level].is_some()
                && *self.val_slot_key != *debug_ptrs[level].as_ref().unwrap().val_slot_key
            {
                // Make sure that the next node in the level is what we expect it to be,
                // ensuring that none of our fast paths skip nodes in their level.
                debug_assert_eq!(
                    debug_ptrs[level].as_ref().map(|p| *p.val_slot_key),
                    next_node_for_level.as_ref().map(|p| *p.val_slot_key)
                );
            }
        }

        let mut longest_link_s = 0;
        let links: Vec<(Option<String>, bool)> = self
            .links
            .iter()
            .enumerate()
            .rev()
            .map(|(level, link_opt)| -> (Option<String>, bool) {
                // update the debug ptrs with our links
                let next_valid_node_for_level = debug_ptrs[level].as_ref().map(|p| &*p);
                let has_next_for_level = match (next_node, link_opt) {
                    (None, _) => true,
                    (Some(next_link), Some(our_link)) => next_link.key() == our_link.key(),
                    _ => match (next_valid_node_for_level, next_node) {
                        (Some(ref expected_val), Some(ref next_node_val)) => {
                            expected_val.key() == next_node_val.key()
                        }
                        _ => false,
                    },
                };
                if next_valid_node_for_level.map(|p| p.val_slot_key) == Some(self.val_slot_key) {
                    // If we are the node that was pointed to by the last node in this level,
                    // set the next valid node in the level to be the one we point to.
                    debug_ptrs[level] = link_opt.clone();

                    let link_s = format!("{:?}", *self.val_slot_key);
                    let string_len = link_s.len();
                    if string_len > longest_link_s {
                        longest_link_s = string_len;
                    }
                    return (Some(link_s), has_next_for_level);
                }

                (None, has_next_for_level)
            })
            // we have to collect because the iterator is lazy and the max length won't be computed
            .collect();

        let pad = |s: &mut String, has_next: bool| {
            let length_diff = longest_link_s - s.len();
            for _ in 0..=length_diff {
                s.push('-');
            }
            s.push(if has_next { '>' } else { '-' });
        };

        let mut padding = String::new();
        for _ in 0..=longest_link_s {
            padding.push('-');
        }

        let mut s = String::new();
        for (i, (mut link_s_opt, has_next)) in links.into_iter().enumerate() {
            match link_s_opt {
                Some(ref mut link_s) => {
                    pad(link_s, has_next);
                    s.push_str(&link_s);
                }
                None => {
                    s.push_str(&padding);
                    // If the next item is a node, then we push the arrowhead.  Otherwise, just
                    // push another dash.
                    s.push(if has_next { '>' } else { '-' });
                }
            }
            if i != NOTE_SKIP_LIST_LEVELS - 1 {
                s.push('\n');
            }
        }
        write!(fmt, "{}", s)
    }
}

impl Index<SlabKey<NoteSkipListNode>> for Slab<NoteSkipListNode> {
    type Output = NoteSkipListNode;

    #[inline]
    fn index(&self, index: SlabKey<NoteSkipListNode>) -> &NoteSkipListNode {
        if cfg!(debug_assertions) {
            self.get(index.key()).unwrap()
        } else {
            unsafe { &self.get_unchecked(index.key()) }
        }
    }
}

impl Index<SlabKey<NoteBox>> for Slab<NoteBox> {
    type Output = NoteBox;

    #[inline]
    fn index(&self, index: SlabKey<NoteBox>) -> &NoteBox {
        if cfg!(debug_assertions) {
            &self.get(index.key()).unwrap()
        } else {
            unsafe { self.get_unchecked(index.key()) }
        }
    }
}

/// Skip list levels are taken via a geometric distribution - each level has 50% less of a chance
/// to have a shortcut than the one below it.
///
/// TODO: Make O(1)?
#[inline]
pub fn get_skip_list_level() -> usize {
    let rng = unsafe { &mut (*RNG) };
    let mut level = 0;
    for _ in 0..(NOTE_SKIP_LIST_LEVELS - 1) {
        if rng.gen::<bool>() {
            break;
        }
        level += 1;
    }
    level
}

#[inline]
pub fn blank_shortcuts<T>() -> [Option<T>; NOTE_SKIP_LIST_LEVELS] {
    let mut shortcuts: [Option<T>; NOTE_SKIP_LIST_LEVELS] = unsafe { mem::uninitialized() };
    for link in &mut shortcuts[..] {
        unsafe { ptr::write(link, None) };
    }
    shortcuts
}

impl NoteSkipListNode {
    #[inline]
    pub fn contains_beat(&self, beat: f32) -> bool {
        let note: &NoteBox = if cfg!(debug_assertions) {
            &notes()[self.val_slot_key]
        } else {
            unsafe { notes().get_unchecked(self.val_slot_key.key()) }
        };

        note.start_beat <= beat && note.end_beat >= beat
    }

    /// Returns the slot index of the last node that has a value less than that of the target
    /// value.  If `target_val` is less than all other values in the collection, then `None`
    /// is returned.
    pub fn search<'a>(
        &'a mut self,
        target_val: f32,
        self_key: &SlabKey<NoteSkipListNode>,
        levels: &mut [SlabKey<NoteSkipListNode>; NOTE_SKIP_LIST_LEVELS],
    ) {
        // if we try searching a node greater than the target value, we've messed up badly
        debug_assert!((*self.val_slot_key).end_beat <= target_val);
        // Starting with the top level and working down, check if the value behind the shortcut is
        // higher or lower than the current value.
        let mut link_level = NOTE_SKIP_LIST_LEVELS - 1;
        loop {
            if let Some(shortcut_node_slot_key) = &mut self.links[link_level] {
                let shortcut_node: &mut NoteSkipListNode = &mut *(shortcut_node_slot_key.clone());

                // if this shortcut value is still smaller, take the shortcut and continue searching.
                if shortcut_node.val_slot_key.end_beat < target_val {
                    // Record the preceeding index for all levels for which we have a pointer
                    for level in &mut levels[0..=link_level] {
                        *level = shortcut_node_slot_key.clone();
                    }
                    return shortcut_node.search(target_val, shortcut_node_slot_key, levels);
                } else {
                    // we're the largest node less than `target_val` in the current level
                    levels[link_level] = self_key.clone();
                }
            }

            if link_level == 0 {
                return;
            }
            link_level -= 1;
        }
    }
}

#[derive(Clone, Default)]
pub struct NoteSkipList {
    pub head_key: Option<SlabKey<NoteSkipListNode>>,
}

impl Debug for NoteSkipList {
    /// We want the end result to look something like this:
    ///
    /// |1.0, 2.0|------------------------->|4.0, 5.0|->x
    /// |1.0, 2.0|->----------->|3.0, 4.0|->|4.0, 5.0|->x
    /// |1.0, 2.0|->|2.0, 3.0|->|3.0, 4.0|->|4.0, 5.0|->x
    ///
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        let mut node_debug_lines = Vec::new();
        // initialize the debug pointers with the head
        if let Some(head_key) = self.head_key.as_ref() {
            init_node_dbg_ptrs(head_key);
        }
        for node in self.iter_nodes() {
            let debug_s = format!("{:?}", node);
            let debug_lines: Vec<String> =
                debug_s.split('\n').map(|s| s.into()).collect::<Vec<_>>();
            node_debug_lines.push(debug_lines);
        }
        let mut s = String::new();
        for i in 0..NOTE_SKIP_LIST_LEVELS {
            for debug_content in &node_debug_lines {
                s.push_str(&debug_content[i]);
            }
            s.push('x');
            if i != NOTE_SKIP_LIST_LEVELS - 1 {
                s.push('\n');
            }
        }

        write!(fmt, "{}", s)
    }
}

pub struct NoteSkipListIterator<'a>(Option<&'a NoteSkipListNode>);

impl<'a> Iterator for NoteSkipListIterator<'a> {
    type Item = NoteBox;

    fn next(&mut self) -> Option<NoteBox> {
        let node = self.0.as_ref()?;
        let note = *self.0?.val_slot_key;
        self.0 = node.links[0].as_ref().map(|key| &**key);
        Some(note)
    }
}

pub struct NoteSkipListNodeIterator<'a>(Option<&'a NoteSkipListNode>);

impl<'a> Iterator for NoteSkipListNodeIterator<'a> {
    type Item = &'a NoteSkipListNode;

    fn next(&mut self) -> Option<&'a NoteSkipListNode> {
        let node = self.0?;
        self.0 = node.links[0].as_ref().map(|key| &**key);
        Some(node)
    }
}

impl NoteSkipList {
    pub fn new() -> Self {
        NoteSkipList { head_key: None }
    }

    #[inline(always)]
    pub fn head(&self) -> Option<&NoteSkipListNode> {
        self.head_key.as_ref().map(|k| &**k)
    }

    #[inline(always)]
    pub fn head_mut(&mut self) -> Option<&mut NoteSkipListNode> {
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

        let head_key = self.head_key.as_mut().unwrap();
        let head: &mut NoteSkipListNode = &mut *(head_key.clone());

        let level = get_skip_list_level();
        // Only bother searching if the head is smaller than the target value.  If the head is
        // larger, we automatically insert it at the front.
        if (*head.val_slot_key).end_beat > note.start_beat {
            // The new note is the smallest one in the list, so insert it before the head.
            // Link to the old head for levels up to the one we generated
            for link in &mut new_node.links[0..=level] {
                *link = self.head_key.clone();
            }

            // Steal links from the old head for all other levels above that
            let old_links_range = (level + 1)..NOTE_SKIP_LIST_LEVELS;
            new_node.links[old_links_range.clone()].clone_from_slice(&head.links[old_links_range]);
            self.head_key = Some(new_node_key);

            // Erase any links from the old head that are above the newly generated level for the
            // new head; we're going to link to those ourselves.
            for link in &mut head.links[(level + 1)..NOTE_SKIP_LIST_LEVELS] {
                *link = None;
            }
            return;
        }

        let mut preceeding_links: [SlabKey<NoteSkipListNode>; NOTE_SKIP_LIST_LEVELS] =
            unsafe { mem::uninitialized() };
        for link in &mut preceeding_links {
            *link = head_key.clone();
        }

        head.search(note.start_beat, head_key, &mut preceeding_links);

        // Insert the new node between this node and its child (if it has one).
        // For levels through the generated level, we link the inserted node to where the
        // previous node was linking before and link the to the new node from it.
        for i in 0..=level {
            let preceeding_node_for_level = &mut *preceeding_links[i];
            new_node.links[i] = preceeding_node_for_level.links[i].clone();
            preceeding_node_for_level.links[i] = Some(new_node_key.clone());
        }

        // For levels after the generated level, we take no action.  We let the existing
        // links stay as they are and leave the new nodes' blank.
    }

    /// Removes any note box that contains the given beat.
    pub fn remove(&mut self, beat: f32) {
        unimplemented!(); // TODO
    }

    pub fn remove_by_dom_id(&mut self, dom_id: usize) {
        unimplemented!(); // TODO
    }

    pub fn iter(&self) -> NoteSkipListIterator {
        NoteSkipListIterator(self.head_key.as_ref().map(|key| &**key))
    }

    pub fn iter_nodes(&self) -> NoteSkipListNodeIterator {
        NoteSkipListNodeIterator(self.head_key.as_ref().map(|key| &**key))
    }
}

/// This data structure holds a list of ordered note boxes
pub struct NoteLines {
    pub lines: Vec<NoteSkipList>,
}

#[derive(Debug)]
pub enum Bounds {
    Intersecting(SlabKey<NoteSkipListNode>),
    Bounded(f32, Option<f32>),
}

impl Bounds {
    pub fn is_bounded(&self) -> bool {
        match self {
            Bounds::Bounded(_, _) => true,
            _ => false,
        }
    }

    pub fn bounds(&self) -> Option<(f32, Option<f32>)> {
        match self {
            Bounds::Bounded(low, high) => Some((*low, *high)),
            _ => None,
        }
    }
}

impl NoteLines {
    pub fn new(lines: usize) -> Self {
        NoteLines {
            lines: vec![NoteSkipList::new(); lines],
        }
    }

    pub fn get_bounds(&mut self, line_ix: usize, beat: f32) -> Bounds {
        let line = &mut self.lines[line_ix];
        let mut head = match line.head_key.clone() {
            Some(node) => node,
            None => return Bounds::Bounded(0.0, None),
        };
        let mut preceeding_links: [SlabKey<NoteSkipListNode>; 5] = unsafe { mem::uninitialized() };
        for link in &mut preceeding_links {
            unsafe { ptr::write(link, line.head_key.as_ref().unwrap().clone()) };
        }
        // If the first value is already greater than the new note, we don't have to search and
        // simply bound it on the top side by the head's start beat.
        if head.contains_beat(beat) {
            return Bounds::Intersecting(line.head_key.as_mut().unwrap().clone());
        } else if head.val_slot_key.start_beat > beat {
            return Bounds::Bounded(0.0, Some(head.val_slot_key.start_beat));
        }
        head.search(beat, line.head_key.as_ref().unwrap(), &mut preceeding_links);

        let preceeding_node = &preceeding_links[0];
        let following_node = match &preceeding_node.links[0] {
            Some(node) => node,
            None => return Bounds::Bounded(preceeding_node.val_slot_key.end_beat, None),
        };
        if following_node.contains_beat(beat) {
            return Bounds::Intersecting(following_node.clone());
        }
        Bounds::Bounded(
            preceeding_node.val_slot_key.end_beat,
            Some(following_node.val_slot_key.start_beat),
        )
    }

    #[inline(always)]
    pub fn insert(&mut self, line_ix: usize, note: NoteBox) {
        self.lines[line_ix].insert(note);
    }

    pub fn move_note(&mut self, prev_line_ix: usize, new_line_ix: usize, dom_id: usize) {
        unimplemented!(); // TODO
    }
}
