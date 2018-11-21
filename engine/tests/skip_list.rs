#![feature(box_syntax, nll, test)]

extern crate engine;
extern crate rand;
extern crate rand_pcg;
extern crate test;

use std::{mem, num::NonZeroU32};

use engine::{
    note_box::NoteBox, selection_box::SelectionRegion, skip_list::*, state::*, util::beats_to_px,
};
use rand::prelude::*;

fn mklines(notes: &[(f32, f32)]) -> NoteLines {
    unsafe { init_state() };
    let mut lines = NoteLines::new(1);
    let mut mkbox = |start_beat: f32, end_beat: f32| {
        lines.insert(0, NoteBox {
            start_beat,
            end_beat,
            dom_id: 0,
        })
    };

    for (start_beat, end_beat) in notes {
        mkbox(*start_beat, *end_beat);
    }

    lines
}

#[test]
fn note_lines_bounds() {
    let mut lines = mklines(&[
        (2.0, 10.0),
        (10.0, 12.0),
        (14.0, 18.0),
        (19.0, 24.0),
        (25.0, 25.0),
    ]);

    assert_eq!(lines.get_bounds(0, 5.0).bounds(), None);
    assert_eq!(lines.get_bounds(0, 1.0).bounds(), Some((0.0, Some(2.0))));
    assert_eq!(lines.get_bounds(0, 2.0).bounds(), None);
    assert_eq!(lines.get_bounds(0, 10.0).bounds(), None);
    assert_eq!(lines.get_bounds(0, 13.0).bounds(), Some((12.0, Some(14.0))));
    assert_eq!(lines.get_bounds(0, 24.2).bounds(), Some((24.0, Some(25.0))));
    assert_eq!(lines.get_bounds(0, 200.2).bounds(), Some((25.0, None)));
}

#[test]
fn note_lines_bounds_2() {
    let mut lines = mklines(&[(4.65, 7.35), (16.5, 18.8)]);

    assert_eq!(lines.get_bounds(0, 30.0).bounds(), Some((18.8, None)));
    assert_eq!(
        lines.get_bounds(0, 10.95).bounds(),
        Some((7.35, Some(16.5)))
    );
}

#[test]
fn note_lines_bounds_3() {
    let mut lines = mklines(&[(5.0, 10.0)]);

    assert_eq!(lines.get_bounds(0, 20.0).bounds(), Some((10.0, None)));
}

#[bench]
fn bench_add_two(b: &mut test::Bencher) {
    extern crate rand_pcg;
    state().rng = rand_pcg::Pcg32::from_seed(unsafe { mem::transmute(0u128) });
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

#[test]
fn skiplist_construction_iteration() {
    unsafe { init_state() };

    let mut skip_list = NoteSkipList::new();
    let mut notes: Vec<_> = vec![(1.0, 2.0), (5.0, 10.0), (3.0, 4.0)]
        .into_iter()
        .map(|(start_beat, end_beat)| NoteBox {
            start_beat,
            end_beat,
            dom_id: 0,
        })
        .collect();;
    for note in &notes {
        skip_list.insert(note.clone());
    }

    let actual_notes: Vec<_> = skip_list.iter().collect();
    notes.sort();
    assert_eq!(notes, actual_notes);
}

#[test]
fn skiplist_bulk_insertion() {
    unsafe { init_state() };
    let mut skip_list = NoteSkipList::new();

    let mut notes = Vec::with_capacity(1000 / 2);
    for i in 0..500 {
        notes.push(((i * 2) as f32, ((i * 2) + 1) as f32));
    }
    state().rng.shuffle(&mut notes);

    for (start_beat, end_beat) in notes {
        skip_list.insert(NoteBox {
            start_beat,
            end_beat,
            dom_id: 0,
        });
        println!("{:?}\n", skip_list);
    }
}

#[bench]
fn skiplist_level_generation(b: &mut test::Bencher) {
    unsafe { init_state() };
    b.iter(get_skip_list_level)
}

#[test]
fn skiplist_node_debug() {
    unsafe { init_state() };

    let next_node_ptr: SlabKey<NoteSkipListNode> = state()
        .nodes
        .insert(NoteSkipListNode {
            val_slot_key: state()
                .notes
                .insert(NoteBox {
                    start_beat: 20.0,
                    end_beat: 30.0,
                    dom_id: 0,
                })
                .into(),
            links: blank_shortcuts(),
        })
        .into();

    let node = NoteSkipListNode {
        val_slot_key: state()
            .notes
            .insert(NoteBox {
                start_beat: 0.0,
                end_beat: 10.0,
                dom_id: 0,
            })
            .into(),
        links: [
            Some(next_node_ptr.clone()),
            Some(next_node_ptr),
            None,
            None,
            None,
        ],
    };
    let node_key: SlabKey<NoteSkipListNode> = state().nodes.insert(node).into();
    let node: &NoteSkipListNode = &*node_key;
    // pretend that we're inside of a full `SkipList` and initialize the global debug pointers
    init_node_dbg_ptrs(&node_key);

    let expected = "|0, 10|--\n|0, 10|--\n|0, 10|--\n|0, 10|->\n|0, 10|->";
    let actual = format!("{:?}", node);
    println!("\nEXPECTED:\n{}", expected);
    println!("\nACTUAL:\n{}", actual);
    assert_eq!(expected, &actual);
}

#[test]
fn skiplist_debug_fmt() {
    unsafe { init_state() };

    let mut skip_list = NoteSkipList::new();
    let notes = &[(1., 2.), (4., 5.), (3., 4.), (2., 3.)]
        .iter()
        .map(|(start, end)| NoteBox {
            start_beat: *start,
            end_beat: *end,
            dom_id: 0,
        })
        .map(|note| -> SlabKey<NoteBox> { state().notes.insert(note).into() })
        .collect::<Vec<_>>()[0..4];
    let [note_1_2, note_4_5, note_3_4, note_2_3] = match notes {
        [n1, n2, n3, n4] => [n1, n2, n3, n4],
        _ => unreachable!(),
    };

    let mknode = |val_slot_key: SlabKey<NoteBox>,
                  links: [Option<SlabKey<NoteSkipListNode>>; NOTE_SKIP_LIST_LEVELS]|
     -> SlabKey<NoteSkipListNode> {
        state()
            .nodes
            .insert(NoteSkipListNode {
                val_slot_key,
                links,
            })
            .into()
    };

    let node_4_5 = mknode(*note_4_5, [None, None, None, None, None]);
    let node_3_4 = mknode(*note_3_4, [
        Some(node_4_5.clone()),
        Some(node_4_5.clone()),
        None,
        None,
        None,
    ]);
    let node_2_3 = mknode(*note_2_3, [Some(node_3_4.clone()), None, None, None, None]);
    let head = mknode(*note_1_2, [
        Some(node_2_3.clone()),
        Some(node_3_4.clone()),
        Some(node_4_5.clone()),
        Some(node_4_5.clone()),
        None,
    ]);
    println!("head: \n{:?}", *head);

    // state().nodes are pre-linked, so all we have to do is insert the head.
    skip_list.head_key = Some(head);
    let expected = "|1, 2|------------------------->x\n|1, 2|----------------->|4, 5|->x\n|1, \
                    2|----------------->|4, 5|->x\n|1, 2|--------->|3, 4|->|4, 5|->x\n|1, 2|->|2, \
                    3|->|3, 4|->|4, 5|->x";
    let actual = format!("{:?}", skip_list);
    println!("\nEXPECTED:\n{}", expected);
    println!("\nACTUAL:\n{}", actual);
    assert_eq!(actual, expected);
}

#[test]
fn skiplist_region_iter() {
    unsafe { init_state() };

    let mut lines = NoteLines::new(6);
    let notes = &[
        (0, (1.0, 2.0)),
        (0, (4.0, 6.0)),
        (0, (6.0, 7.0)),
        (1, (0.0, 6.0)),
        (2, (1.0, 2.0)),
        (2, (3.0, 4.0)),
        (2, (6.0, 7.0)),
        (4, (2.0, 5.0)),
        (5, (0.0, 7.0)),
        // the following will not be matched by the selection box
        (0, (8.0, 10.0)),
        (1, (7.0, 9.0)),
        (2, (0.0, 0.1)),
        (5, (9.0, 10.0)),
    ];
    for (i, (line_ix, (start_beat, end_beat))) in notes.iter().enumerate() {
        lines.insert(*line_ix, NoteBox {
            dom_id: i,
            start_beat: *start_beat,
            end_beat: *end_beat,
        });
    }

    type Note = (usize, (f32, f32));
    fn compare_notes(a: &'_ Note, b: &'_ Note) -> ::std::cmp::Ordering {
        if a.0 == b.0 {
            ((a.1).0).partial_cmp(&(b.1).0).unwrap()
        } else {
            a.0.cmp(&b.0)
        }
    }

    let selection_start_beat = 0.4;
    let selection_end_beat = 6.5;
    let mut expected_results = notes[0..=8].to_owned();
    expected_results.sort_by(compare_notes);

    let mut actual_results = lines
        .iter_region(&SelectionRegion {
            x: beats_to_px(selection_start_beat) as usize,
            y: LINE_HEIGHT / 2,
            width: beats_to_px(selection_end_beat - selection_start_beat) as usize,
            height: PADDED_LINE_HEIGHT * 5,
        })
        .map(|note_data| {
            (
                note_data.line_ix,
                (note_data.note_box.start_beat, note_data.note_box.end_beat),
            )
        })
        .collect::<Vec<_>>();
    actual_results.sort_by(compare_notes);

    assert_eq!(expected_results, actual_results);
}
