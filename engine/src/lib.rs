extern crate common;
extern crate wasm_bindgen;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Chord {
    beats: f32,
    notes: Vec<&'static str>,
}

fn chord<T: Into<Vec<&'static str>>>(beats: f32, notes: T) -> Chord {
    Chord {
        beats,
        notes: notes.into(),
    }
}

#[wasm_bindgen(module = "./index")]
extern "C" {
    fn chord01(duration_ms: usize);
// fn playChords(bpm: f32, chords: &[Chord]);
}

#[wasm_bindgen]
pub fn init() {
    // playChords(
    //     100.0,
    //     &[
    //         chord(4., vec!["Eb4", "G4", "Bb4", "D5"]),
    //         chord(4., vec!["C4", "E4", "G4", "B4"]),
    //     ],
    // )
}
