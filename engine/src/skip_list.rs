//! Defines a skip list data structure that is used to hold the intervals occupied by all of the
//! notes in all of the lines.  It supports functions for finding the preceeding and following
//! note for a given beat, handling cases where the query is within an existing note or unbounded
//! one or both sides.
//!
//! The time complexity for insertion, removal, and querying is `O(log n)`.

extern crate test;
use std::f32;
use std::fmt::{self, Debug, Formatter};
use std::marker::PhantomData;
use std::mem;
use std::num::NonZeroU32;
use std::ops::{Deref, DerefMut, Index};
use std::ptr;
use std::usize;

use rand::prelude::*;
use slab::Slab;

use super::*;

pub type NodeSlabKey = SlabKey<NoteSkipListNode>;
pub type NoteBoxSlabKey = SlabKey<NoteBox>;
pub type PreceedingLinks = [NodeSlabKey; NOTE_SKIP_LIST_LEVELS];
pub type LinkOpts = [Option<NodeSlabKey>; NOTE_SKIP_LIST_LEVELS];

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

impl Deref for NoteBoxSlabKey {
    type Target = NoteBox;

    fn deref(&self) -> &NoteBox {
        if cfg!(debug_assertions) {
            &state().notes[self.key()]
        } else {
            unsafe { state().notes.get_unchecked(self.key()) }
        }
    }
}

impl Deref for NodeSlabKey {
    type Target = NoteSkipListNode;

    fn deref(&self) -> &NoteSkipListNode {
        if cfg!(debug_assertions) {
            &state().nodes[self.key()]
        } else {
            unsafe { state().nodes.get_unchecked(self.key()) }
        }
    }
}

impl DerefMut for NoteBoxSlabKey {
    fn deref_mut(&mut self) -> &mut NoteBox {
        if cfg!(debug_assertions) {
            &mut state().notes[self.key()]
        } else {
            unsafe { state().notes.get_unchecked_mut(self.key()) }
        }
    }
}

impl DerefMut for NodeSlabKey {
    fn deref_mut(&mut self) -> &mut NoteSkipListNode {
        if cfg!(debug_assertions) {
            &mut state().nodes[self.key()]
        } else {
            unsafe { state().nodes.get_unchecked_mut(self.key()) }
        }
    }
}

#[derive(Clone, PartialEq)]
pub struct NoteSkipListNode {
    pub val_slot_key: SlabKey<NoteBox>,
    /// Contains links to the next node in the sequence as well as all shortcuts that exist for
    /// that node.  In the case that there are no shortcuts available
    pub links: LinkOpts,
}

/// When debug-printing a `NoteSkipList`, we aren't able to implement debugging of an individual
/// node as a pure function.  The reason for this that the arrows drawn between the different
/// nodes depend on what nodes previously linked to it, and the distance can be large.
///
/// This data structure holds a pointer to the next node for each of the levels of the skip list,
/// allowing equality to be tested for arrow drawing.
#[thread_local]
pub static mut SKIP_LIST_NODE_DEBUG_POINTERS: *mut LinkOpts = ptr::null_mut();

pub fn init_node_dbg_ptrs(head_key: &NodeSlabKey) {
    for p in get_debug_ptrs() {
        *p = Some(head_key.clone());
    }
}

fn get_debug_ptrs() -> &'static mut LinkOpts {
    unsafe { &mut *SKIP_LIST_NODE_DEBUG_POINTERS }
}

fn init_preceeding_links(head_key: &NodeSlabKey) -> PreceedingLinks {
    let mut preceeding_links: PreceedingLinks = unsafe { mem::uninitialized() };
    for link in &mut preceeding_links {
        *link = head_key.clone();
    }
    preceeding_links
}

pub fn debug_preceeding_links(links: &PreceedingLinks) -> String {
    format!(
        "{:?}",
        links
            .iter()
            .map(|key| &*key.val_slot_key)
            .collect::<Vec<_>>()
    )
}

pub fn debug_links(links: &LinkOpts) -> String {
    format!(
        "{:?}",
        links
            .iter()
            .map(|k| k.as_ref().map(|k| &*k.val_slot_key))
            .collect::<Vec<_>>()
    )
}

impl Debug for NoteSkipListNode {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        let debug_ptrs = get_debug_ptrs();
        let next_node_key = &self.links[0];
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
                let has_next_for_level = match (next_node_key, link_opt) {
                    (None, _) => true,
                    (Some(next_link), Some(our_link)) => next_link.key() == our_link.key(),
                    _ => match (next_valid_node_for_level, next_node_key) {
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

impl Index<NodeSlabKey> for Slab<NoteSkipListNode> {
    type Output = NoteSkipListNode;

    #[inline]
    fn index(&self, index: NodeSlabKey) -> &NoteSkipListNode {
        if cfg!(debug_assertions) {
            self.get(index.key()).unwrap_or_else(|| {
                panic!(
                    "Tried to get node with slab index {} but it doesn't exist",
                    index.key()
                )
            })
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
            &self.get(index.key()).unwrap_or_else(|| {
                panic!(
                    "Tried to get note with slab index {} but it doesn't exist",
                    index.key()
                )
            })
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
    let mut level = 0;
    for _ in 0..(NOTE_SKIP_LIST_LEVELS - 1) {
        if state().rng.gen::<bool>() {
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

#[derive(Debug, PartialEq)]
pub enum Bounds {
    Intersecting(NodeSlabKey),
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

impl NoteSkipListNode {
    #[inline(always)]
    pub fn contains_beat(&self, beat: f32) -> bool {
        self.val_slot_key.contains(beat)
    }

    #[inline(always)]
    pub fn intersects_beats(&self, start_beat: f32, end_beat: f32) -> bool {
        self.val_slot_key.intersects(&NoteBox {
            dom_id: 0,
            start_beat,
            end_beat,
        })
    }

    /// Returns the slot index of the last node that has a value less than that of the target
    /// value.  If `target_val` is less than all other values in the collection, then `None`
    /// is returned.
    pub fn search<'a>(
        &'a mut self,
        target_val: f32,
        self_key: &NodeSlabKey,
        levels: &mut PreceedingLinks,
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
                if shortcut_node.val_slot_key.end_beat <= target_val {
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

    #[inline(always)]
    pub fn next_node(&self) -> Option<&Self> {
        self.links[0].as_ref().map(|p| &**p)
    }

    #[inline(always)]
    pub fn next_node_mut(&mut self) -> Option<&mut Self> {
        self.links[0].as_mut().map(|p| &mut **p)
    }
}

#[derive(Clone, Default)]
pub struct NoteSkipList {
    pub head_key: Option<NodeSlabKey>,
}

impl Debug for NoteSkipList {
    /// We want the end result to look something like this:
    ///
    /// |1.0, 2.0|------------------------->|4.0, 5.0|->x
    /// |1.0, 2.0|------------->|3.0, 4.0|->|4.0, 5.0|->x
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
        self.0 = node.next_node();
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

pub struct NoteSkipListRegionIterator<'a> {
    pub start_line_ix: usize,
    pub end_line_ix: usize,
    pub min_beat: f32,
    pub max_beat: f32,
    pub lines: &'a NoteLines,
    pub cur_line_ix: usize,
    pub cur_node: Option<&'a NoteSkipListNode>,
}

impl<'a> NoteSkipListRegionIterator<'a> {
    /// Moves this iterator to the next line in `NoteLines`.  Recursively calls itself until a
    /// valid starting node has been found or all lines in the search range are exhausted.
    /// Returns `None` if this iterator is exhausted.
    fn next_line(&mut self) -> Option<()> {
        self.cur_line_ix = if self.cur_line_ix == usize::MAX {
            0
        } else {
            self.cur_line_ix + 1
        };

        if self.cur_line_ix > self.end_line_ix {
            return None;
        }

        // look for the first node in the new line that is in the valid range
        self.cur_node = match self.lines.find_first_node_in_range(
            self.cur_line_ix,
            self.min_beat,
            self.max_beat,
        ) {
            Some(node) => {
                if node.intersects_beats(self.min_beat, self.max_beat) {
                    // the found note intersects the start beat, so it's valid
                    Some(node)
                } else if node.next_node().is_some() {
                    // the found note doesn't match itself, but its child does
                    node.next_node()
                } else {
                    // this was the last node in the line, and there are none after it
                    return self.next_line();
                }
            }
            None => return self.next_line(),
        };

        Some(())
    }
}

#[derive(Debug)]
pub struct NoteData<'a> {
    pub line_ix: usize,
    pub note_box: &'a NoteBox,
}

impl<'a> NoteData<'a> {
    pub fn get_selection_region(&self) -> SelectionRegion {
        SelectionRegion {
            x: (self.note_box.start_beat * BEAT_LENGTH_PX) as usize,
            y: self.line_ix * PADDED_LINE_HEIGHT,
            width: ((self.note_box.end_beat - self.note_box.start_beat) * BEAT_LENGTH_PX) as usize,
            height: LINE_HEIGHT,
        }
    }

    pub fn intersects_region(&self, region: &SelectionRegion) -> bool {
        let our_region = self.get_selection_region();
        // regions intersect if any point bounding our origin is contained in the other region
        our_region.iter_points().any(|pt| region.contains_point(pt))
    }
}

impl<'a> Into<SelectedNoteData> for NoteData<'a> {
    fn into(self) -> SelectedNoteData {
        SelectedNoteData {
            line_ix: self.line_ix,
            dom_id: self.note_box.dom_id,
            start_beat: self.note_box.start_beat,
        }
    }
}

impl<'a> Iterator for NoteSkipListRegionIterator<'a> {
    type Item = NoteData<'a>;

    fn next(&mut self) -> Option<NoteData<'a>> {
        let node = match self.cur_node {
            Some(node) if node.intersects_beats(self.min_beat, self.max_beat) => node,
            _ => {
                self.next_line()?;
                return self.next();
            }
        };

        self.cur_node = node.links[0].as_ref().map(|key| &**key);

        Some(NoteData {
            line_ix: self.cur_line_ix,
            note_box: &*node.val_slot_key,
        })
    }
}

/// Deallocates the slab slots for both the node and its `NoteBox`, returning the inner `NoteBox`.
#[allow(clippy::needless_pass_by_value)]
fn dealloc_node(node_key: NodeSlabKey) -> NoteBox {
    let node = state().nodes.remove(node_key.key());
    state().notes.remove(node.val_slot_key.key())
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

    /// Inserts a node into the skip list in order.  Returns `false` if the node was inserted
    /// successfully and `true` if there is an intersecting node blocking it from being inserted.
    pub fn insert(&mut self, note: NoteBox) -> bool {
        let new_node = NoteSkipListNode {
            val_slot_key: state().notes.insert(note).into(),
            links: blank_shortcuts(),
        };
        let new_node_key: NodeSlabKey = state().nodes.insert(new_node).into();
        let new_node: &mut NoteSkipListNode = &mut *(new_node_key.clone());

        // Deallocate the new node and note we created for this insertion attempt and return `true`
        let insertion_fail = || {
            dealloc_node(new_node_key.clone());
            true
        };

        if self.head_key.is_none() {
            self.head_key = Some(new_node_key);
            return false;
        }

        let head_key = self.head_key.as_mut().unwrap();
        let head: &mut NoteSkipListNode = &mut *(head_key.clone());

        let level = get_skip_list_level();
        // Only bother searching if the head is smaller than the target value.  If the head is
        // larger, we automatically insert it at the front.
        if (*head.val_slot_key).end_beat > note.start_beat {
            if head.val_slot_key.intersects_exclusive(&note) {
                return insertion_fail();
            }

            // The new note is the smallest one in the list, so insert it before the head.
            // Link to the old head for levels up to the one we generated
            for link in &mut new_node.links[0..=level] {
                *link = self.head_key.clone();
            }

            // Steal links from the old head for all other levels above that
            let old_links_range = (level + 1)..NOTE_SKIP_LIST_LEVELS;
            for level in old_links_range.clone() {
                let preceeding_node = match head.links[level].as_ref() {
                    Some(node) => node,
                    None => continue,
                };

                debug_assert!(!preceeding_node.val_slot_key.intersects_exclusive(&note));
            }
            new_node.links[old_links_range.clone()].clone_from_slice(&head.links[old_links_range]);
            self.head_key = Some(new_node_key);

            // Erase any links from the old head that are above the newly generated level for the
            // new head; we're going to link to those ourselves.
            for link in &mut head.links[(level + 1)..NOTE_SKIP_LIST_LEVELS] {
                *link = None;
            }
            return false;
        }

        let mut preceeding_links = init_preceeding_links(&head_key);
        head.search(note.start_beat, head_key, &mut preceeding_links);

        // check if the note before the new one intersects it
        if preceeding_links[0].val_slot_key.intersects_exclusive(&note) {
            return insertion_fail();
        }
        // check if the note after the new one intersects it (if it exists)
        if let Some(next_node) = &preceeding_links[0].links[0] {
            if next_node.val_slot_key.intersects_exclusive(&note) {
                return insertion_fail();
            }
        }

        // Insert the new node between this node and its child (if it has one).
        // For levels through the generated level, we link the inserted node to where the
        // previous node was linking before and link the to the new node from it.
        #[allow(clippy::needless_range_loop)]
        for i in 0..=level {
            let preceeding_node_for_level = &mut *preceeding_links[i];
            new_node.links[i] = preceeding_node_for_level.links[i].clone();
            debug_assert!(!preceeding_node_for_level
                .val_slot_key
                .intersects_exclusive(&note));
            preceeding_node_for_level.links[i] = Some(new_node_key.clone());
        }

        // For levels after the generated level, we take no action.  We let the existing
        // links stay as they are and leave the new nodes' blank.
        false
    }

    /// Removes any note box that contains the given beat.
    pub fn remove(&mut self, start_beat: f32) -> Option<NoteBox> {
        let head_key = self
            .head_key
            .as_mut()
            .expect("Attempted to remove node from line with no head node")
            .clone();
        let head = &mut *(head_key.clone());

        if head.val_slot_key.start_beat == start_beat {
            // The head is being removed.  Replace it with the next child (copying over links where
            // applicable) if there is one.
            if let Some(new_head_key) = head.links[0].clone() {
                let new_head = &mut *new_head_key.clone();
                for level in 1..NOTE_SKIP_LIST_LEVELS {
                    if new_head.links[level].is_none()
                        && head.links[level] != Some(new_head_key.clone())
                    {
                        new_head.links[level] = head.links[level].clone();
                    }
                }
                self.head_key = Some(new_head_key);
            } else {
                self.head_key = None;
            }

            return Some(dealloc_node(head_key.clone()));
        }

        let mut preceeding_links = init_preceeding_links(&head_key);
        head.search(start_beat, &head_key, &mut preceeding_links);
        let removed_node_key = preceeding_links[0].links[0].clone()?;

        // For each preceeding link, sever the link to the node being removed and attach it to
        // wherever the node being removed is pointing for that level (if anywhere).
        let removed_node = &*removed_node_key;
        #[allow(clippy::needless_range_loop, clippy::manual_memcpy)]
        for level in 0..NOTE_SKIP_LIST_LEVELS {
            preceeding_links[level].links[level] = removed_node.links[level].clone();
        }

        // free the slab slots for the removed node and note
        Some(dealloc_node(removed_node_key))
    }

    pub fn iter(&self) -> NoteSkipListIterator {
        NoteSkipListIterator(self.head())
    }

    pub fn iter_nodes(&self) -> NoteSkipListNodeIterator {
        NoteSkipListNodeIterator(self.head())
    }

    fn find_first_node_in_range(
        &self,
        start_beat: f32,
        end_beat: f32,
    ) -> Option<&NoteSkipListNode> {
        let head = self.head()?;
        if head.val_slot_key.start_beat > end_beat {
            return None;
        } else if head.intersects_beats(start_beat, end_beat) {
            return Some(head);
        }

        let mut cur_node = head;
        let mut max_level = NOTE_SKIP_LIST_LEVELS - 1;
        'outer: loop {
            let checking_node = cur_node;
            for level in (0..=max_level).rev() {
                match checking_node.links[level] {
                    // shortcut takes us to an invalid node that is still before our desired range
                    Some(ref node) if node.val_slot_key.end_beat < start_beat => {
                        max_level = level;
                        cur_node = &*node;
                        continue 'outer;
                    }
                    // shortcut takes us to a valid node, but one lower down may still lead us to
                    // an earlier one that is still valid so keep checking.
                    Some(ref node) if node.intersects_beats(start_beat, end_beat) => {
                        cur_node = &*node
                    }
                    _ => (),
                }
            }
            break;
        }

        Some(cur_node)
    }

    pub fn find_first_node_before_beat_mut(&mut self, beat: f32) -> Option<&mut NoteSkipListNode> {
        let head_key = self.head_key.as_mut()?;
        let mut head = head_key.clone();

        if head.val_slot_key.end_beat > beat {
            return None;
        }

        let mut preceeding_links = init_preceeding_links(&head_key);
        head.search(beat, &head_key, &mut preceeding_links);

        Some(&mut state().nodes[preceeding_links[0].key()]) // borrow checker begone
    }
}

/// This data structure holds a list of ordered note boxes
pub struct NoteLines {
    pub lines: Vec<NoteSkipList>,
}

impl NoteLines {
    #[inline(always)]
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
        let mut preceeding_links: PreceedingLinks = unsafe { mem::uninitialized() };
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

    /// Inserts a node into the skip list at the specified level in order.  Returns `false` if the
    /// node was inserted successfully and `true` if there is an intersecting node blocking it from
    /// being inserted.
    #[inline(always)]
    pub fn insert(&mut self, line_ix: usize, note: NoteBox) -> bool {
        self.lines[line_ix].insert(note)
    }

    #[inline(always)]
    pub fn remove(&mut self, line_ix: usize, start_beat: f32) -> Option<NoteBox> {
        self.lines[line_ix].remove(start_beat)
    }

    /// Attempts to move a note from one line to another, keeping it at the same start and end
    /// beat.  Returns `false` if the move is successful and `true` if there was another note
    /// blocking it from being inserted on the destination line or there was no note with the
    /// specified `start_beat` in the source line.
    pub fn move_note_vertical(
        &mut self,
        src_line_ix: usize,
        dst_line_ix: usize,
        start_beat: f32,
    ) -> bool {
        if let Some(note) = self.lines[src_line_ix].remove(start_beat) {
            if self.lines[dst_line_ix].insert(note) {
                // insertion failed due to a collision; re-insert into the original line.
                let insertion_error = self.lines[src_line_ix].insert(note);
                debug_assert!(!insertion_error);
                true
            } else {
                false
            }
        } else {
            true
        }
    }

    /// Moves a note horizontally a given number of beats, stopping early if it collides with
    /// another note or the beginning of the line.  This can be done by simply mutating the
    /// targeted note since it is guarenteed to not change its line or index in its line.
    ///
    /// Returns the start beat of the note after its move.
    pub fn move_note_horizontal(
        &mut self,
        line_ix: usize,
        start_beat: f32,
        beats_to_move: f32,
    ) -> f32 {
        let (preceeding_note_end_beat, target_node) =
            match self.find_first_node_before_beat_mut(line_ix, start_beat) {
                Some(preceeding_node) => (
                    preceeding_node.val_slot_key.end_beat,
                    preceeding_node.next_node_mut().unwrap(),
                ),
                None => {
                    // No preceeding node, so it's either the head or doesn't exist.
                    let head = self.lines[line_ix].head_mut().unwrap();
                    debug_assert_eq!(head.val_slot_key.start_beat, start_beat);

                    (0.0, head)
                }
            };

        let target_note = target_node.val_slot_key;
        let following_note_start_beat = target_node
            .next_node()
            .map(|node| node.val_slot_key.start_beat)
            .unwrap_or(f32::INFINITY);
        let target_note_length = target_note.width();
        let new_target_node_start = clamp(
            target_note.start_beat + beats_to_move,
            preceeding_note_end_beat,
            following_note_start_beat - target_note_length,
        );

        target_node.val_slot_key.start_beat = new_target_node_start;
        target_node.val_slot_key.end_beat = new_target_node_start + target_note_length;

        new_target_node_start
    }

    pub fn iter_region<'a>(
        &'a self,
        region: &'a SelectionRegion,
    ) -> NoteSkipListRegionIterator<'a> {
        let start_line_ix = (region.y - (region.y % PADDED_LINE_HEIGHT)) / PADDED_LINE_HEIGHT;
        let end_px_ix = region.y + region.height;
        let end_line_ix = ((end_px_ix - (end_px_ix % PADDED_LINE_HEIGHT)) / PADDED_LINE_HEIGHT)
            .min(LINE_COUNT - 1);
        let min_beat = px_to_beat(region.x as f32);
        let max_beat = px_to_beat((region.x + region.width) as f32);

        let mut iterator = NoteSkipListRegionIterator {
            start_line_ix,
            end_line_ix,
            min_beat,
            max_beat,
            lines: &self,
            cur_line_ix: if start_line_ix == 0 {
                usize::MAX
            } else {
                start_line_ix - 1
            },
            cur_node: None,
        };
        // Initialize the iterator's state with the first line
        iterator.next_line();
        iterator
    }

    #[inline(always)]
    pub fn find_first_node_in_range(
        &self,
        line_ix: usize,
        start_beat: f32,
        end_beat: f32,
    ) -> Option<&NoteSkipListNode> {
        self.lines[line_ix].find_first_node_in_range(start_beat, end_beat)
    }

    #[inline(always)]
    pub fn find_first_node_before_beat_mut(
        &mut self,
        line_ix: usize,
        beat: f32,
    ) -> Option<&mut NoteSkipListNode> {
        self.lines[line_ix].find_first_node_before_beat_mut(beat)
    }
}
