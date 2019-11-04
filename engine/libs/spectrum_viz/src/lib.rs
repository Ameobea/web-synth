#[macro_use]
extern crate lazy_static;
#[macro_use]
extern crate serde_derive;

use std::{
    mem::{self, MaybeUninit},
    sync::Once,
};

use palette::{
    encoding::{linear::Linear, srgb::Srgb},
    gradient::Gradient,
    rgb::Rgb,
};
use wasm_bindgen::prelude::*;

const BUFFER_SIZE: usize = 8192;

pub struct Context {
    pub byte_frequency_data: [u8; BUFFER_SIZE],
    pub pixel_buffer: [u8; BUFFER_SIZE * 4],
    pub color_fn: usize,
    pub scaler_fn: usize,
}

type ColorLUT = [[u8; 4]; 255];

const SCALER_FN_COUNT: usize = 2;

fn pink_colorizer(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    *unsafe {
        PINK_GRADIENT_LUTS
            .get_unchecked(scaler_fn_ix)
            .get_unchecked(val as usize)
    }
}
fn rd_yl_bu_colorizer(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    *unsafe {
        RD_YL_BU_GRADIENT_LUTS
            .get_unchecked(scaler_fn_ix)
            .get_unchecked(val as usize)
    }
}
fn radar_colorizer(scaler_fn_ix: usize, val: u8) -> [u8; 4] {
    *unsafe {
        RADAR_GRADIENT_LUTS
            .get_unchecked(scaler_fn_ix)
            .get_unchecked(val as usize)
    }
}

const COLOR_FNS: &[fn(scaler_fn_ix: usize, val: u8) -> [u8; 4]] =
    &[pink_colorizer, rd_yl_bu_colorizer, radar_colorizer];

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
            [0x00, 0x00, 0x00],
        ]);

        build_luts(&Gradient::with_domain(color_steps))
    };
}

#[derive(Serialize)]
pub struct SettingDefinition {
    pub name: &'static str,
    pub description: Option<&'static str>,
    pub id: usize,
}

#[derive(Serialize)]
pub struct ConfigDefinition {
    pub scaler_functions: Vec<SettingDefinition>,
    pub color_functions: Vec<SettingDefinition>,
}

#[derive(Deserialize)]
pub struct Config {
    pub color_fn: usize,
    pub scaler_fn: usize,
}

static ONCE: Once = Once::new();

fn maybe_init() {
    ONCE.call_once(|| {
        console_error_panic_hook::set_once();

        let log_level = if cfg!(debug_assertions) {
            log::Level::Trace
        } else {
            log::Level::Info
        };
        wasm_logger::init(wasm_logger::Config::new(log_level));
    });
}

/// Returns a JSON-serialized array of scaler function definitions
#[wasm_bindgen]
pub fn get_config_definition() -> String {
    maybe_init();

    let config = ConfigDefinition {
        scaler_functions: vec![
            SettingDefinition {
                name: "Linear",
                description: None,
                id: 0,
            },
            SettingDefinition {
                name: "Exponential",
                description: None,
                id: 1,
            },
        ],
        color_functions: vec![
            SettingDefinition {
                name: "Pink",
                description: None,
                id: 0,
            },
            SettingDefinition {
                name: "RdYlBu",
                description: Some("Red-Yellow-Blue"),
                id: 1,
            },
            SettingDefinition {
                name: "Radar",
                description: Some("Color scheme modeled after radar weather maps: https://www.ncl.ucar.edu/Document/Graphics/ColorTables/Images/radar_labelbar.png"),
                id: 2,
            }
        ],
    };

    serde_json::to_string(&config).expect("Failed to serialize config to JSON")
}

#[wasm_bindgen]
pub fn new_context(conf_str: &str) -> *mut Context {
    let conf: Config =
        serde_json::from_str(conf_str).expect("Invalid conf string provided to `new_context`.");

    let ctx = Context {
        byte_frequency_data: [255u8; BUFFER_SIZE],
        pixel_buffer: [255u8; BUFFER_SIZE * 4],
        color_fn: conf.color_fn,
        scaler_fn: conf.scaler_fn,
    };
    Box::into_raw(Box::new(ctx))
}

#[wasm_bindgen]
pub fn set_conf(ctx_ptr: *mut Context, conf_str: &str) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };
    let conf: Config =
        serde_json::from_str(conf_str).expect("Invalid conf string provided to `new_context`.");
    ctx.color_fn = conf.color_fn;
    ctx.scaler_fn = conf.scaler_fn;
    mem::forget(ctx);
}

#[wasm_bindgen]
pub fn process_viz_data(ctx_ptr: *mut Context) {
    let mut ctx = unsafe { Box::from_raw(ctx_ptr) };
    let color_fn = COLOR_FNS
        .get(ctx.color_fn)
        .unwrap_or_else(|| panic!("No color fn found with index {}", ctx.color_fn));

    for (i, val) in (&ctx.byte_frequency_data[..]).iter().enumerate() {
        let [r, g, b, _] = color_fn(ctx.scaler_fn, *val);
        ctx.pixel_buffer[i * 4] = r;
        ctx.pixel_buffer[i * 4 + 1] = g;
        ctx.pixel_buffer[i * 4 + 2] = b;
    }

    mem::forget(ctx);
}

#[wasm_bindgen]
pub fn get_byte_frequency_data_ptr(ctx_ptr: *mut Context) -> *const [u8; BUFFER_SIZE] {
    let ctx = unsafe { Box::from_raw(ctx_ptr) };
    let byte_array_ptr = &ctx.byte_frequency_data as *const _;
    mem::forget(ctx);
    byte_array_ptr
}

#[wasm_bindgen]
pub fn get_pixel_data_ptr(ctx_ptr: *mut Context) -> *const [u8; BUFFER_SIZE * 4] {
    let ctx = unsafe { Box::from_raw(ctx_ptr) };
    let byte_array_ptr = &ctx.pixel_buffer as *const _;
    mem::forget(ctx);
    byte_array_ptr
}

#[wasm_bindgen]
pub fn drop_context(ctx_ptr: *mut Context) { drop(unsafe { Box::from_raw(ctx_ptr) }) }
