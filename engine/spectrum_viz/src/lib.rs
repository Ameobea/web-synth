#[macro_use]
extern crate lazy_static;

use std::mem::MaybeUninit;

use palette::{
  encoding::{linear::Linear, srgb::Srgb},
  gradient::Gradient,
  rgb::Rgb,
};

mod conf;
#[cfg(feature = "line_viz")]
mod line_viz;

const BUFFER_SIZE: usize = 8192;

pub struct Context {
  pub byte_frequency_data: [u8; BUFFER_SIZE],
  pub pixel_buffer: [u8; BUFFER_SIZE * 4],
  pub color_fn: usize,
  pub scaler_fn: usize,
}

impl Context {
  pub fn process_viz_data(&mut self) {
    let color_fn_ix = self.color_fn;
    let color_fn = COLOR_FNS
      .get(color_fn_ix)
      .unwrap_or_else(|| panic!("No color fn found with index {}", color_fn_ix));

    for (i, val) in self.byte_frequency_data.iter_mut().rev().enumerate() {
      let [r, g, b, _] = color_fn(self.scaler_fn, *val);
      self.pixel_buffer[i * 4] = r;
      self.pixel_buffer[i * 4 + 1] = g;
      self.pixel_buffer[i * 4 + 2] = b;
    }
  }
}

type ColorLUT = [[u8; 4]; 256];

// This is straight broken and causes insane low level buggy madness \/
// Use `wee_alloc` as the global allocator.
// #[global_allocator]
// static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

const SCALER_FN_COUNT: usize = 2;

#[cfg(debug_assertions)]
mod colorizers {
  use crate::*;

  pub fn pink(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    PINK_GRADIENT_LUTS[scaler_fn_ix][val as usize]
  }

  pub fn rd_yl_bu(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    RD_YL_BU_GRADIENT_LUTS[scaler_fn_ix][val as usize]
  }

  pub fn radar(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    RADAR_GRADIENT_LUTS[scaler_fn_ix][val as usize]
  }
}

#[cfg(not(debug_assertions))]
mod colorizers {
  use crate::*;

  pub fn pink(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    *unsafe {
      PINK_GRADIENT_LUTS
        .get_unchecked(scaler_fn_ix)
        .get_unchecked(val as usize)
    }
  }

  pub fn rd_yl_bu(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    *unsafe {
      RD_YL_BU_GRADIENT_LUTS
        .get_unchecked(scaler_fn_ix)
        .get_unchecked(val as usize)
    }
  }

  pub fn radar(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    *unsafe {
      RADAR_GRADIENT_LUTS
        .get_unchecked(scaler_fn_ix)
        .get_unchecked(val as usize)
    }
  }
}

const COLOR_FNS: &[fn(scaler_fn_ix: usize, val: u8) -> [u8; 4]] =
  &[colorizers::pink, colorizers::rd_yl_bu, colorizers::radar];

fn linear_scaler(val: u8) -> f32 { (val as f32) / 255. }
fn exponential_scaler(val: u8) -> f32 { ((val as f32).powf(3.) / 65025.) / 255. }

const SCALER_FNS: [fn(val: u8) -> f32; SCALER_FN_COUNT] = [linear_scaler, exponential_scaler];

/// Builds an array of LUTs for each possible byte of input.  Builds a LUT for each scaler function.
fn build_luts(gradient: &Gradient<Rgb<Linear<Srgb>>>) -> [ColorLUT; SCALER_FN_COUNT] {
  let mut luts = MaybeUninit::<[ColorLUT; SCALER_FN_COUNT]>::uninit();

  for i in 0..SCALER_FN_COUNT {
    let scaler_fn = unsafe { SCALER_FNS.get_unchecked(i) };
    let mut lut = MaybeUninit::<ColorLUT>::uninit();
    for j in 0..255 {
      let color = gradient.get(scaler_fn(j));
      unsafe {
        (lut.as_mut_ptr() as *mut [u8; 4]).add(j as usize).write([
          (color.red * 255.) as u8,
          (color.green * 255.) as u8,
          (color.blue * 255.) as u8,
          255,
        ])
      }
    }

    unsafe {
      (luts.as_mut_ptr() as *mut ColorLUT)
        .add(i)
        .write(lut.assume_init())
    }
  }

  unsafe { luts.assume_init() }
}

fn build_even_color_steps(color_steps: &[[u8; 3]]) -> Vec<(f32, Rgb<Linear<Srgb>>)> {
  color_steps
    .into_iter()
    .enumerate()
    .map(|(i, [r, g, b])| {
      (
        i as f32 / 10.,
        Rgb::new(*r as f32 / 255., *g as f32 / 255., *b as f32 / 255.),
      )
    })
    .collect()
}

lazy_static! {
  pub static ref PINK_GRADIENT_LUTS: [ColorLUT; SCALER_FN_COUNT] = {
    let gradient: Gradient<Rgb<Linear<Srgb>>> = Gradient::with_domain(vec![
      (0., Rgb::new(0., 0., 0.)),
      (1., Rgb::new(1., 0.752941, 0.79607843)),
    ]);

    build_luts(&gradient)
  };
  pub static ref RD_YL_BU_GRADIENT_LUTS: [ColorLUT; SCALER_FN_COUNT] = {
    let color_steps = build_even_color_steps(&[
      [165, 0, 38],
      [215, 48, 39],
      [244, 109, 67],
      [253, 174, 97],
      [254, 224, 144],
      [255, 255, 191],
      [224, 243, 248],
      [171, 217, 233],
      [116, 173, 209],
      [69, 117, 180],
      [49, 54, 149],
    ]);

    build_luts(&Gradient::with_domain(color_steps))
  };
  pub static ref RADAR_GRADIENT_LUTS: [ColorLUT; SCALER_FN_COUNT] = {
    let color_steps = build_even_color_steps(&[
      [0, 0, 0],
      [0, 0, 0],
      [0, 255, 255],
      [0x00, 0x9e, 0xff],
      [0x00, 0x00, 0xff],
      [0x02, 0x83, 0xb1],
      [0x00, 0xff, 0x00],
      [0x01, 0xb1, 0x0c],
      [0xff, 0xd7, 0x00],
      [0xff, 0x99, 0x00],
      [0xff, 0x00, 0x00],
      [0xde, 0x00, 0x14],
      [0xbe, 0x00, 0x33],
      [0x79, 0x00, 0x6d],
      [0x79, 0x30, 0xa1],
      [0xc4, 0xa4, 0xd5],
    ]);

    build_luts(&Gradient::with_domain(color_steps))
  };
}

#[cfg(feature = "bindgen")]
pub mod exports {
  use super::*;
  use wasm_bindgen::prelude::*;

  /// Returns a JSON-serialized array of scaler function definitions
  #[wasm_bindgen]
  pub fn get_config_definition() -> String {
    wbg_logging::maybe_init();
    String::from(crate::conf::CONFIG_JSON)
  }

  #[wasm_bindgen]
  pub fn new_context(color_fn: usize, scaler_fn: usize) -> *mut Context {
    wbg_logging::maybe_init();

    Box::into_raw(Box::new(Context {
      byte_frequency_data: [255u8; BUFFER_SIZE],
      pixel_buffer: [255u8; BUFFER_SIZE * 4],
      color_fn,
      scaler_fn,
    }))
  }

  #[wasm_bindgen]
  pub fn set_conf(ctx_ptr: *mut Context, color_fn: usize, scaler_fn: usize) {
    unsafe {
      (*ctx_ptr).color_fn = color_fn;
      (*ctx_ptr).scaler_fn = scaler_fn;
    }
  }

  #[wasm_bindgen]
  pub fn process_viz_data(ctx: *mut Context) {
    let ctx = unsafe { &mut *ctx };
    ctx.process_viz_data();
  }

  #[wasm_bindgen]
  pub fn get_byte_frequency_data_ptr(ctx_ptr: *mut Context) -> *const [u8; BUFFER_SIZE] {
    unsafe { &(*ctx_ptr).byte_frequency_data as *const _ }
  }

  #[wasm_bindgen]
  pub fn get_pixel_data_ptr(ctx_ptr: *mut Context) -> *const [u8; BUFFER_SIZE * 4] {
    unsafe { &(*ctx_ptr).pixel_buffer as *const _ }
  }

  #[wasm_bindgen]
  pub fn drop_context(ctx_ptr: *mut Context) { drop(unsafe { Box::from_raw(ctx_ptr) }); }
}
