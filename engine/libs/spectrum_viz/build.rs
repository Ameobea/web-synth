#[macro_use]
extern crate serde_derive;

use std::{
    fs::File,
    io::{BufRead, BufReader, Error, Write},
};

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

fn main() {
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

    let config_json = serde_json::to_string(&config).expect("Failed to serialize config to JSON");
    let mut config_file =
        File::create("./src/conf.json").expect("Failed to create config JSON file");
    write!(config_file, "{}", &config_json).expect("Failed to write config to JSON file");
}
