//! Defines a custom skip list data structure that is used to hold the intervals occupied by all of
//! the notes in all of the lines.  It supports functions for finding the preceeding and following
//! note for a given beat, handling cases where the query is within an existing note or unbounded
//! one or both sides.
//!
//! The time complexity for insertion, removal, and querying is `O(log n)`.

extern crate test;
use std::{
    f32,
    fmt::{self, Debug, Formatter},
    marker::PhantomData,
    mem,
    num::NonZeroU32,
    ptr, usize,
};

use rand::prelude::*;
use slab::Slab;

use super::{super::super::views::midi_editor::prelude::*, prelude::*}; // TODO: Remove

pub struct SlabKey<T>(NonZeroU32, PhantomData<T>);

// Doing this manually forces `Copy` to be implemented for `SlabKey<T>` even if `T` doesn't impl
// `Copy` itself.
impl<T> Copy for SlabKey<T> {}

impl<T> Clone for SlabKey<T> {
    fn clone(&self) -> Self { SlabKey(self.0, PhantomData) }
}

impl<T> PartialEq for SlabKey<T> {
    fn eq(&self, other: &Self) -> bool { self.0 == other.0 }
}

pub type NodeSlabKey<S> = SlabKey<NoteSkipListNode<S>>;
pub type NoteBoxSlabKey<S> = SlabKey<NoteBox<S>>;
pub type PreceedingLinks<S> = [NodeSlabKey<S>; 5]; // TODO
pub type LinkOpts<S> = [Option<NodeSlabKey<S>>; 5]; // TODO

impl<T> Debug for SlabKey<T> {
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> { write!(fmt, "{}", self.key()) }
}

impl<T> SlabKey<T> {
    pub fn key(self) -> usize { self.0.get() as usize }
}

impl<T> From<usize> for SlabKey<T> {
    fn from(key: usize) -> Self {
        SlabKey(
            unsafe { NonZeroU32::new_unchecked(key as u32) },
            PhantomData,
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NoteSkipListNode<S> {
    pub val_slot_key: SlabKey<NoteBox<S>>,
    /// Contains links to the next node in the sequence as well as all shortcuts that exist for
    /// that node.  In the case that there are no shortcuts available
    pub links: LinkOpts<S>,
}

/// When debug-printing a `NoteSkipList`, we aren't able to implement debugging of an individual
/// node as a pure function.  The reason for this that the arrows drawn between the different
/// nodes depend on what nodes previously linked to it, and the distance can be large.
///
/// This data structure holds a pointer to the next node for each of the levels of the skip list,
/// allowing equality to be tested for arrow drawing.
#[thread_local]
pub static mut SKIP_LIST_NODE_DEBUG_POINTERS: *mut LinkOpts<usize> = ptr::null_mut();

pub fn init_node_dbg_ptrs(head_key: NodeSlabKey<usize>) {
    for p in get_debug_ptrs() {
        *p = Some(head_key);
    }
}

fn get_debug_ptrs() -> &'static mut LinkOpts<usize> {
    unsafe { &mut *SKIP_LIST_NODE_DEBUG_POINTERS }
}

fn init_preceeding_links<S>(head_key: NodeSlabKey<S>) -> PreceedingLinks<S> {
    let mut preceeding_links: PreceedingLinks<S> = unsafe { mem::uninitialized() };
    for link in &mut preceeding_links {
        *link = head_key;
    }
    preceeding_links
}

pub fn debug_preceeding_links<S>(line: &NoteSkipList<S>, links: &PreceedingLinks<S>) -> String {
    format!(
        "{:?}",
        links
            .iter()
            .map(|key| line.get_note(line.get_node(*key).val_slot_key))
            .collect::<Vec<_>>()
    )
}

pub fn debug_links<S>(line: &NoteSkipList<S>, links: &LinkOpts<S>) -> String {
    format!(
        "{:?}",
        links
            .iter()
            .map(|key_opt| key_opt.map(|key| line.get_note(line.get_node(key).val_slot_key)))
            .collect::<Vec<_>>()
    )
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
pub enum Bounds<'a, S> {
    Intersecting(&'a NoteBox<S>),
    Bounded(f32, Option<f32>),
}

impl<'a, S> Bounds<'a, S> {
    pub fn is_bounded(&self) -> bool {
        match self {
            Bounds::Bounded(..) => true,
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

#[derive(Debug, Clone, Copy)]
pub struct NoteEvent {
    pub line_ix: usize,
    pub is_start: bool,
    pub beat: f32,
}

#[derive(Clone, Copy)]
pub enum FrontierNode<'a, S> {
    NoneConsumed(&'a NoteSkipList<S>, &'a NoteSkipListNode<S>),
    StartBeatConsumed(&'a NoteSkipList<S>, &'a NoteSkipListNode<S>),
}

impl<'a, S> FrontierNode<'a, S> {
    pub fn beat(&'a self) -> f32 {
        match self {
            FrontierNode::NoneConsumed(list, node) =>
                list.get_note(node.val_slot_key).bounds.start_beat,
            FrontierNode::StartBeatConsumed(list, node) =>
                list.get_note(node.val_slot_key).bounds.end_beat,
        }
    }

    pub fn next(&self) -> Option<Self> {
        match self {
            FrontierNode::NoneConsumed(list, node) =>
                Some(FrontierNode::StartBeatConsumed(list, node)),
            FrontierNode::StartBeatConsumed(list, node) => list
                .next_node(node)
                .map(|next_node| FrontierNode::NoneConsumed(list, next_node)),
        }
    }

    pub fn get_note_event(&self, line_ix: usize) -> NoteEvent {
        NoteEvent {
            line_ix,
            is_start: match self {
                FrontierNode::NoneConsumed(..) => true,
                FrontierNode::StartBeatConsumed(..) => false,
            },
            beat: self.beat(),
        }
    }
}

pub struct NoteEventIterator<'a, S> {
    pub cur_beat: f32,
    pub frontier_nodes: [Option<FrontierNode<'a, S>>; LINE_COUNT],
}

impl<'a, S> Iterator for NoteEventIterator<'a, S> {
    type Item = NoteEvent;

    fn next(&mut self) -> Option<NoteEvent> {
        let mut min_valid_line_ix = None;

        for (i, frontier_node) in self.frontier_nodes.iter().enumerate() {
            if let Some(frontier_node) = frontier_node {
                let beat = frontier_node.beat();
                if beat == self.cur_beat {
                    min_valid_line_ix = Some(i);
                    break;
                }

                let cur_min_beat_opt =
                    min_valid_line_ix.map(|i| self.frontier_nodes[i].unwrap().beat());
                match cur_min_beat_opt {
                    Some(cur_min_beat) if cur_min_beat < frontier_node.beat() => (),
                    _ => min_valid_line_ix = Some(i),
                }
            }
        }

        min_valid_line_ix.map(|line_ix| {
            let frontier_node_opt = &mut self.frontier_nodes[line_ix];
            let frontier_node = frontier_node_opt.unwrap();
            self.cur_beat = frontier_node.beat();
            let event = frontier_node.get_note_event(line_ix);

            // get the next event and swap it into the frontier array
            let next_frontier_node_opt = frontier_node.next();
            mem::replace(frontier_node_opt, next_frontier_node_opt);

            event
        })
    }
}

impl<'a, S> NoteEventIterator<'a, S> {
    pub fn new(note_lines: &'a NoteLines<S>, start_beat: f32) -> Self {
        let frontier_nodes = unsafe {
            let mut frontier_nodes: [Option<FrontierNode<'a, S>>; LINE_COUNT] =
                mem::uninitialized();
            let frontier_nodes_ptr =
                &mut frontier_nodes as *mut _ as *mut Option<FrontierNode<'a, S>>;
            for i in 0..LINE_COUNT {
                let line = note_lines.lines.get_unchecked(i);
                ptr::write(
                    frontier_nodes_ptr.add(i),
                    line.head()
                        .map(|head_node| FrontierNode::NoneConsumed(line, head_node)),
                );
            }
            frontier_nodes
        };

        NoteEventIterator {
            cur_beat: start_beat,
            frontier_nodes,
        }
    }
}

impl<S> NoteSkipListNode<S> {
    pub fn contains_beat(&self, line: &NoteSkipList<S>, beat: f32) -> bool {
        line.get_note(self.val_slot_key).bounds.contains(beat)
    }

    // TODO: This needs to be a `NoteBox` method or something.  And we need to pull it out anyway.
    // Actually, we need to change `beats` to some other unit and keep it internal.
    pub fn intersects_beats(&self, line: &NoteSkipList<S>, start_beat: f32, end_beat: f32) -> bool {
        line.get_note(self.val_slot_key)
            .bounds
            .intersects(&NoteBoxBounds {
                start_beat,
                end_beat,
            })
    }

    /// Returns the slot index of the last node that has a value less than that of the target
    /// value.  If `target_val` is less than all other values in the collection, then `None`
    /// is returned.
    pub fn search<'a>(
        &'a self,
        list: &NoteSkipList<S>,
        target_val: f32,
        self_key: NodeSlabKey<S>,
        levels: &mut PreceedingLinks<S>,
    ) {
        let note = *list.get_note(self.val_slot_key);
        // if we try searching a node greater than the target value, we've messed up badly
        debug_assert!(note.bounds.end_beat <= target_val);
        // Starting with the top level and working down, check if the value behind the shortcut is
        // higher or lower than the current value.
        let mut link_level = NOTE_SKIP_LIST_LEVELS - 1;
        loop {
            if let Some(shortcut_node_slot_key) = self.links[link_level] {
                let shortcut_node: &NoteSkipListNode<S> = list.get_node(shortcut_node_slot_key);
                let shortcut_note = list.get_note(shortcut_node.val_slot_key);

                // if this shortcut value is still smaller, take the shortcut and continue
                // searching.
                if shortcut_note.bounds.end_beat <= target_val {
                    // Record the preceeding index for all levels for which we have a pointer
                    for level in &mut levels[0..=link_level] {
                        *level = shortcut_node_slot_key;
                    }
                    return shortcut_node.search(list, target_val, shortcut_node_slot_key, levels);
                } else {
                    // we're the largest node less than `target_val` in the current level
                    levels[link_level] = self_key;
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
pub struct NoteSkipList<S> {
    pub notes: Slab<NoteBox<S>>,
    pub nodes: Slab<NoteSkipListNode<S>>,
    pub head_key: Option<NodeSlabKey<S>>,
}

impl Debug for NoteSkipList<usize> {
    /// We want the end result to look something like this:
    ///
    /// |1.0, 2.0|------------------------->|4.0, 5.0|->x
    /// |1.0, 2.0|------------->|3.0, 4.0|->|4.0, 5.0|->x
    /// |1.0, 2.0|->|2.0, 3.0|->|3.0, 4.0|->|4.0, 5.0|->x
    fn fmt(&self, fmt: &mut Formatter) -> Result<(), fmt::Error> {
        let mut node_debug_lines = Vec::new();
        // initialize the debug pointers with the head
        if let Some(head_key) = self.head_key {
            init_node_dbg_ptrs(head_key);
        }

        for node in self.iter_nodes() {
            let debug_s = self.debug_node(node);
            // Don't ask why it's "\\n" and not '\n'; I don't know.
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

pub struct NoteSkipListIterator<'a, S> {
    line: &'a NoteSkipList<S>,
    cur_node: Option<&'a NoteSkipListNode<S>>,
}

impl<'a, S> Iterator for NoteSkipListIterator<'a, S> {
    type Item = NoteBox<S>;

    fn next(&mut self) -> Option<NoteBox<S>> {
        let node = self.cur_node?;
        let note = self.line.get_note(node.val_slot_key);
        self.cur_node = self.line.next_node(node);
        Some(*note)
    }
}

pub struct NoteSkipListNodeIterator<'a, S> {
    line: &'a NoteSkipList<S>,
    cur_node: Option<&'a NoteSkipListNode<S>>,
}

impl<'a, S> Iterator for NoteSkipListNodeIterator<'a, S> {
    type Item = &'a NoteSkipListNode<S>;

    fn next(&mut self) -> Option<&'a NoteSkipListNode<S>> {
        let node = self.cur_node?;
        self.cur_node = self.line.next_node(node);
        Some(node)
    }
}

pub struct NoteSkipListRegionIterator<'a, S> {
    pub start_line_ix: usize,
    pub end_line_ix: usize,
    pub min_beat: f32,
    pub max_beat: f32,
    pub lines: &'a NoteLines<S>,
    pub cur_line_ix: usize,
    pub cur_node: Option<&'a NoteSkipListNode<S>>,
}

impl<'a, S> NoteSkipListRegionIterator<'a, S> {
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
        let cur_line = &self.lines.lines[self.cur_line_ix]; // TODO: helper function
        self.cur_node = match self.lines.find_first_node_in_range(
            self.cur_line_ix,
            self.min_beat,
            self.max_beat,
        ) {
            Some(node) => {
                if node.intersects_beats(cur_line, self.min_beat, self.max_beat) {
                    // the found note intersects the start beat, so it's valid
                    Some(node)
                } else if cur_line.next_node(node).is_some() {
                    // the found note doesn't match itself, but its child does
                    cur_line.next_node(node)
                } else {
                    // this was the last node in the line, and there are none after it
                    return self.next_line();
                }
            },
            None => return self.next_line(),
        };

        Some(())
    }
}

#[derive(Debug)]
pub struct NoteData<'a, S> {
    pub line_ix: usize,
    pub note_box: &'a NoteBox<S>,
}

impl<'a, S> NoteData<'a, S> {
    pub fn get_selection_region(&self) -> SelectionRegion {
        SelectionRegion {
            x: (self.note_box.bounds.start_beat * BEAT_LENGTH_PX) as usize,
            y: self.line_ix * PADDED_LINE_HEIGHT,
            width: ((self.note_box.bounds.end_beat - self.note_box.bounds.start_beat)
                * BEAT_LENGTH_PX) as usize,
            height: LINE_HEIGHT,
        }
    }

    pub fn intersects_region(&self, region: &SelectionRegion) -> bool {
        let our_region = self.get_selection_region();
        // regions intersect if any point bounding our origin is contained in the other region
        our_region.iter_points().any(|pt| region.contains_point(pt))
    }
}

impl<'a> Into<SelectedNoteData> for NoteData<'a, usize> {
    fn into(self) -> SelectedNoteData {
        SelectedNoteData {
            line_ix: self.line_ix,
            dom_id: self.note_box.data,
            start_beat: self.note_box.bounds.start_beat,
            width: self.note_box.bounds.width(),
        }
    }
}

impl<'a, S> Iterator for NoteSkipListRegionIterator<'a, S> {
    type Item = NoteData<'a, S>;

    fn next(&mut self) -> Option<NoteData<'a, S>> {
        let node = match self.cur_node {
            Some(node)
                if node.intersects_beats(
                    &self.lines.lines[self.cur_line_ix],
                    self.min_beat,
                    self.max_beat,
                ) =>
                node,
            _ => {
                self.next_line()?;
                return self.next();
            },
        };

        let cur_line = &self.lines.lines[self.cur_line_ix];
        self.cur_node = node.links[0].map(|key| cur_line.get_node(key));

        Some(NoteData {
            line_ix: self.cur_line_ix,
            note_box: cur_line.get_note(node.val_slot_key),
        })
    }
}

impl<S> NoteSkipList<S> {
    pub fn new() -> Self {
        let mut notes = Slab::with_capacity(NOTES_SLAB_CAPACITY);
        let mut nodes = Slab::with_capacity(NODES_SLAB_CAPACITY);

        // Insert placeholders since we can't use index 0 due to the `NonZeroU32` optimization
        notes.insert(NoteBox {
            data: unsafe { mem::uninitialized() },
            bounds: NoteBoxBounds {
                start_beat: 0.,
                end_beat: 0.,
            },
        });
        nodes.insert(NoteSkipListNode {
            val_slot_key: 0.into(),
            links: blank_shortcuts(),
        });

        NoteSkipList {
            head_key: None,
            notes,
            nodes,
        }
    }

    pub fn get_note<'a>(&'a self, key: SlabKey<NoteBox<S>>) -> &'a NoteBox<S> {
        &self.notes[key.key()]
    }

    pub fn get_note_mut<'a>(&'a mut self, key: SlabKey<NoteBox<S>>) -> &'a mut NoteBox<S> {
        &mut self.notes[key.key()]
    }

    pub fn get_node<'a>(&'a self, key: SlabKey<NoteSkipListNode<S>>) -> &'a NoteSkipListNode<S> {
        &self.nodes[key.key()]
    }

    pub fn get_node_mut<'a>(
        &'a mut self,
        key: SlabKey<NoteSkipListNode<S>>,
    ) -> &'a mut NoteSkipListNode<S> {
        &mut self.nodes[key.key()]
    }

    pub fn head(&self) -> Option<&NoteSkipListNode<S>> { self.head_key.map(|k| self.get_node(k)) }

    pub fn head_mut(&mut self) -> Option<&mut NoteSkipListNode<S>> {
        match self.head_key {
            Some(k) => Some(self.get_node_mut(k)),
            None => None,
        }
    }

    pub fn next_node(&self, node: &NoteSkipListNode<S>) -> Option<&NoteSkipListNode<S>> {
        node.links[0].map(|p| self.get_node(p))
    }

    /// This is a sad function because we can't just give `&'a mut self` and
    /// `&'a mut NoteSkipListNode` due to  lifetime reasons.  It works though :shrug:
    pub fn next_node_mut<'a>(
        &'a mut self,
        node_key: SlabKey<NoteSkipListNode<S>>,
    ) -> Option<&'a mut NoteSkipListNode<S>> {
        let node = &self.nodes[node_key.key()];
        node.links[0].map(move |p| self.get_node_mut(p))
    }

    /// Deallocates the slab slots for both the node and its `NoteBox`, returning the inner
    /// `NoteBox`.
    fn dealloc_node(&mut self, node_key: NodeSlabKey<S>) -> NoteBox<S> {
        let node = self.nodes.remove(node_key.key());
        self.notes.remove(node.val_slot_key.key())
    }

    /// Inserts a node into the skip list in order.  Returns `false` if the node was inserted
    /// successfully and `true` if there is an intersecting node blocking it from being inserted.
    pub fn insert(&mut self, note: NoteBox<S>) -> bool {
        let mut new_node = NoteSkipListNode {
            val_slot_key: self.notes.insert(note).into(),
            links: blank_shortcuts(),
        };

        if self.head_key.is_none() {
            let new_node_key = self.nodes.insert(new_node);
            self.head_key = Some(new_node_key.into());
            return false;
        }

        let head_key = self.head_key.unwrap();

        let level = get_skip_list_level();
        let head_note = self.get_note(self.get_node(head_key).val_slot_key);
        // Only bother searching if the head is smaller than the target value.  If the head is
        // larger, we automatically insert it at the front.
        if head_note.bounds.end_beat > note.bounds.start_beat {
            if head_note.bounds.intersects_exclusive(&note.bounds) {
                self.notes.remove(new_node.val_slot_key.key());
                return true;
            }

            // The new note is the smallest one in the list, so insert it before the head.
            // Link to the old head for levels up to the one we generated
            for link in &mut new_node.links[0..=level] {
                *link = Some(head_key);
            }

            // Steal links from the old head for all other levels above that
            let old_links_range = (level + 1)..NOTE_SKIP_LIST_LEVELS;
            for level in old_links_range.clone() {
                let preceeding_node = match self.head_mut().unwrap().links[level] {
                    Some(node_key) => self.get_node(node_key),
                    None => continue,
                };
                let preceeding_note = self.get_note(preceeding_node.val_slot_key);

                debug_assert!(!preceeding_note.bounds.intersects_exclusive(&note.bounds));
            }
            new_node.links[old_links_range.clone()]
                .clone_from_slice(&self.head().unwrap().links[old_links_range]);
            self.head_key = Some(self.nodes.insert(new_node).into());

            // Erase any links from the old head that are above the newly generated level for the
            // new head; we're going to link to those ourselves.
            for link in &mut self.head_mut().unwrap().links[(level + 1)..NOTE_SKIP_LIST_LEVELS] {
                *link = None;
            }
            return false;
        }

        let mut preceeding_links = init_preceeding_links(head_key);
        self.head().unwrap().search(
            &self,
            note.bounds.start_beat,
            head_key,
            &mut preceeding_links,
        );

        // check if the note before the new one intersects it
        let first_link_node = self.get_node(preceeding_links[0]);
        let first_link_note = self.get_note(first_link_node.val_slot_key);
        if first_link_note.bounds.intersects_exclusive(&note.bounds) {
            self.notes.remove(new_node.val_slot_key.key());
            return true;
        }

        // check if the note after the new one intersects it (if it exists)

        if let Some(next_node_key) = first_link_node.links[0] {
            let next_node = self.get_node(next_node_key);
            let next_note = self.get_note(next_node.val_slot_key);
            if next_note.bounds.intersects_exclusive(&note.bounds) {
                self.notes.remove(new_node.val_slot_key.key());
                return true;
            }
        }

        // There are no intersecting notes, so we can actually insert it!
        //
        // Insert the new node between this node and its child (if it has one).
        // For levels through the generated level, we link the inserted node to where the
        // previous node was linking before and link the to the new node from it.
        //
        // We link the new node to the following nodes here.  We can't link the previous nodes to
        // the new one here as well due to lifetime issues.
        for i in 0..=level {
            let preceeding_node_for_level = &mut self.get_node(preceeding_links[i]);
            new_node.links[i] = preceeding_node_for_level.links[i];
            debug_assert!(!self
                .get_note(preceeding_node_for_level.val_slot_key)
                .bounds
                .intersects_exclusive(&note.bounds));
        }

        // Actually insert the new node into the nodes slab
        let new_node_key: SlabKey<NoteSkipListNode<S>> = self.nodes.insert(new_node).into();

        for i in 0..=level {
            let preceeding_node_for_level = self.get_node_mut(preceeding_links[i]);
            preceeding_node_for_level.links[i] = Some(new_node_key);
        }

        // For levels after the generated level, we take no action.  We let the existing
        // links stay as they are and leave the new nodes' blank.
        false
    }

    /// Removes any note box that contains the given beat.
    pub fn remove(&mut self, start_beat: f32) -> Option<NoteBox<S>> {
        let head_key = self
            .head_key
            .expect("Attempted to remove node from line with no head node");
        let head_note = {
            let head = self.get_node(head_key);
            *self.get_note(head.val_slot_key)
        };

        if head_note.bounds.start_beat == start_beat {
            // The head is being removed.  Replace it with the next child (copying over links where
            // applicable) if there is one.

            // It's sad we have to clone this, but that's the price we pay for lifetime safety.
            // Think of it as the lifetime tax.
            let head_links = self.get_node(head_key).links;
            if let Some(new_head_key) = head_links[0] {
                let new_head = self.get_node_mut(new_head_key);
                for level in 1..NOTE_SKIP_LIST_LEVELS {
                    if new_head.links[level].is_none() && head_links[level] != Some(new_head_key) {
                        new_head.links[level] = head_links[level];
                    }
                }
                self.head_key = Some(new_head_key);
            } else {
                self.head_key = None;
            }

            return Some(self.dealloc_node(head_key));
        }

        let mut preceeding_links = init_preceeding_links(head_key);
        let head = self.get_node(head_key);
        head.search(self, start_beat, head_key, &mut preceeding_links);
        let removed_node_key = self.get_node(preceeding_links[0]).links[0]?;

        // For each preceeding link, sever the link to the node being removed and attach it to
        // wherever the node being removed is pointing for that level (if anywhere).
        let removed_node_links = self.get_node(removed_node_key).links;
        for level in 0..NOTE_SKIP_LIST_LEVELS {
            self.get_node_mut(preceeding_links[level]).links[level] = removed_node_links[level];
        }

        // free the slab slots for the removed node and note
        Some(self.dealloc_node(removed_node_key))
    }

    pub fn iter<'a>(&'a self) -> impl Iterator<Item = NoteBox<S>> + 'a {
        NoteSkipListIterator {
            line: self,
            cur_node: self.head(),
        }
    }

    pub fn iter_nodes<'a>(&'a self) -> impl Iterator<Item = &'a NoteSkipListNode<S>> + 'a {
        NoteSkipListNodeIterator {
            line: self,
            cur_node: self.head(),
        }
    }

    fn find_first_node_in_range(
        &self,
        start_beat: f32,
        end_beat: f32,
    ) -> Option<&NoteSkipListNode<S>> {
        let head = self.head()?;
        if self.get_note(head.val_slot_key).bounds.start_beat > end_beat {
            return None;
        } else if head.intersects_beats(self, start_beat, end_beat) {
            return Some(head);
        }

        let mut cur_node = head;
        let mut max_level = NOTE_SKIP_LIST_LEVELS - 1;
        'outer: loop {
            let checking_node = cur_node;
            for level in (0..=max_level).rev() {
                match checking_node.links[level] {
                    // shortcut takes us to an invalid node that is still before our desired range
                    Some(node_key)
                        if self
                            .get_note(self.get_node(node_key).val_slot_key)
                            .bounds
                            .end_beat
                            < start_beat =>
                    {
                        let node = self.get_node(node_key);
                        max_level = level;
                        cur_node = &*node;
                        continue 'outer;
                    }
                    // shortcut takes us to a valid node, but one lower down may still lead us to
                    // an earlier one that is still valid so keep checking.
                    Some(node_key)
                        if self
                            .get_node(node_key)
                            .intersects_beats(self, start_beat, end_beat) =>
                        cur_node = &*self.get_node(node_key),
                    _ => (),
                }
            }
            break;
        }

        Some(cur_node)
    }

    pub fn find_first_node_before_beat(&self, beat: f32) -> Option<SlabKey<NoteSkipListNode<S>>> {
        let head_key = self.head_key?;
        let head = self.get_node(head_key);

        if self.get_note(head.val_slot_key).bounds.end_beat > beat {
            return None;
        }

        let mut preceeding_links = init_preceeding_links(head_key);
        head.search(self, beat, head_key, &mut preceeding_links);

        Some(preceeding_links[0])
    }
}

/// This data structure holds a list of ordered note boxes
pub struct NoteLines<S> {
    pub lines: Vec<NoteSkipList<S>>,
}

impl<S> NoteLines<S> {
    pub fn new(line_count: usize) -> Self {
        let lines = Vec::with_capacity(line_count);
        for _ in 0..line_count {
            lines.push(NoteSkipList::new());
        }

        NoteLines { lines }
    }

    pub fn get_bounds(&mut self, line_ix: usize, beat: f32) -> Bounds<S> {
        let line = &mut self.lines[line_ix];
        let head = match line.head_key {
            Some(node_key) => line.get_node(node_key),
            None => return Bounds::Bounded(0.0, None),
        };
        let mut preceeding_links: PreceedingLinks<S> = unsafe { mem::uninitialized() };
        for link in &mut preceeding_links {
            unsafe { ptr::write(link, line.head_key.unwrap()) };
        }
        // If the first value is already greater than the new note, we don't have to search and
        // simply bound it on the top side by the head's start beat.
        if head.contains_beat(line, beat) {
            return Bounds::Intersecting(line.get_note(line.head().unwrap().val_slot_key));
        } else if line.get_note(head.val_slot_key).bounds.start_beat > beat {
            return Bounds::Bounded(
                0.0,
                Some(line.get_note(head.val_slot_key).bounds.start_beat),
            );
        }
        head.search(line, beat, line.head_key.unwrap(), &mut preceeding_links);

        let preceeding_node = line.get_node(preceeding_links[0]);
        let following_node_key = match &preceeding_node.links[0] {
            Some(node_key) => *node_key,
            None =>
                return Bounds::Bounded(
                    line.get_note(preceeding_node.val_slot_key).bounds.end_beat,
                    None,
                ),
        };
        if line.get_node(following_node_key).contains_beat(line, beat) {
            return Bounds::Intersecting(
                line.get_note(line.get_node(following_node_key).val_slot_key),
            );
        }
        Bounds::Bounded(
            line.get_note(preceeding_node.val_slot_key).bounds.end_beat,
            Some(
                line.get_note(line.get_node(following_node_key).val_slot_key)
                    .bounds
                    .start_beat,
            ),
        )
    }

    /// Inserts a node into the skip list at the specified level in order.  Returns `false` if the
    /// node was inserted successfully and `true` if there is an intersecting node blocking it from
    /// being inserted.
    pub fn insert(&mut self, line_ix: usize, note: NoteBox<S>) -> bool {
        self.lines[line_ix].insert(note)
    }

    pub fn remove(&mut self, line_ix: usize, start_beat: f32) -> Option<NoteBox<S>> {
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
        let line = &mut self.lines[line_ix];
        let (preceeding_note_end_beat, target_node_key) =
            match line.find_first_node_before_beat(start_beat) {
                Some(preceeding_node_key) => (
                    line.get_note(line.get_node(preceeding_node_key).val_slot_key)
                        .bounds
                        .end_beat,
                    line.get_node(preceeding_node_key).links[0].unwrap(),
                ),
                None => {
                    // No preceeding node, so it's either the head or doesn't exist.
                    debug_assert_eq!(
                        line.get_note(line.head().unwrap().val_slot_key)
                            .bounds
                            .start_beat,
                        start_beat
                    );
                    let head = line.head_key.unwrap();

                    (0.0, head)
                },
            };

        let following_note_start_beat = line
            .next_node(line.get_node(target_node_key))
            .map(|node| line.get_note(node.val_slot_key).bounds.start_beat)
            .unwrap_or(f32::INFINITY);
        let target_note = line.get_note_mut(line.get_node(target_node_key).val_slot_key);
        let target_note_length = target_note.bounds.width();
        let new_target_node_start = clamp(
            target_note.bounds.start_beat + beats_to_move,
            preceeding_note_end_beat,
            following_note_start_beat - target_note_length,
        );

        target_note.bounds.start_beat = new_target_node_start;
        target_note.bounds.end_beat = new_target_node_start + target_note_length;

        new_target_node_start
    }

    pub fn iter_region<'a>(
        &'a self,
        region: &'a SelectionRegion,
    ) -> impl Iterator<Item = NoteData<'a, S>> + 'a {
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

    pub fn find_first_node_in_range(
        &self,
        line_ix: usize,
        start_beat: f32,
        end_beat: f32,
    ) -> Option<&NoteSkipListNode<S>> {
        self.lines[line_ix].find_first_node_in_range(start_beat, end_beat)
    }

    pub fn iter_events<'a>(
        &'a self,
        start_beat: Option<f32>,
    ) -> impl Iterator<Item = NoteEvent> + 'a {
        NoteEventIterator::new(self, start_beat.unwrap_or(-1.0))
    }
}

impl NoteSkipList<usize> {
    pub fn debug_node(&self, node: &NoteSkipListNode<usize>) -> String {
        let debug_ptrs = get_debug_ptrs();
        let next_node_key = &node.links[0];

        for (level, next_node_for_level) in node.links.iter().enumerate() {
            if next_node_for_level.is_some()
                && debug_ptrs[level].is_some()
                && self.get_note(node.val_slot_key)
                    != self.get_note(self.get_node(debug_ptrs[level].unwrap()).val_slot_key)
            {
                // Make sure that the next node in the level is what we expect it to be,
                // ensuring that none of our fast paths skip nodes in their level.
                debug_assert_eq!(
                    debug_ptrs[level].map(|p| self.get_note(self.get_node(p).val_slot_key)),
                    next_node_for_level.map(|p| self.get_note(self.get_node(p).val_slot_key))
                );
            }
        }

        let mut longest_link_s = 0;
        let links: Vec<(Option<String>, bool)> = node
            .links
            .iter()
            .enumerate()
            .rev()
            .map(|(level, &link_opt)| -> (Option<String>, bool) {
                // update the debug ptrs with our links
                let next_valid_node_for_level = debug_ptrs[level];
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

                if next_valid_node_for_level
                    .map(|p| self.get_note(self.get_node(p).val_slot_key)) == Some(self.get_note(node.val_slot_key)) {
                    // If we are the node that was pointed to by the last node in this level,
                    // set the next valid node in the level to be the one we point to.
                    debug_ptrs[level] = link_opt;
                    let link_s = format!("{:?}", self.get_note(node.val_slot_key));
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
                },
                None => {
                    s.push_str(&padding);
                    // If the next item is a node, then we push the arrowhead.  Otherwise, just
                    // push another dash.
                    s.push(if has_next { '>' } else { '-' });
                },
            }

            if i != NOTE_SKIP_LIST_LEVELS - 1 {
                s.push('\n');
            }
        }

        s
    }
}
