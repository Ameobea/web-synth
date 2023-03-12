use std::{fs::File, io::Write};

use miniserde::{json, Serialize};

#[derive(Serialize)]
pub struct SettingDefinition {
  pub name: String,
  pub description: Option<String>,
  pub id: usize,
}

#[derive(Serialize)]
pub struct ConfigDefinition {
  pub scaler_functions: Vec<SettingDefinition>,
  pub color_functions: Vec<SettingDefinition>,
}

fn main() {
  println!("cargo:rerun-if-changed=build.rs");

  let config = ConfigDefinition {
        scaler_functions: vec![
            SettingDefinition {
                name: "Linear".into(),
                description: None,
                id: 0,
            },
            SettingDefinition {
                name: "Exponential".into(),
                description: None,
                id: 1,
            },
        ],
        color_functions: vec![
            SettingDefinition {
                name: "Pink".into(),
                description: None,
                id: 0,
            },
            SettingDefinition {
                name: "RdYlBu".into(),
                description: Some("Red-Yellow-Blue".into()),
                id: 1,
            },
            SettingDefinition {
                name: "Radar".into(),
                description: Some("Color scheme modeled after radar weather maps: https://www.ncl.ucar.edu/Document/Graphics/ColorTables/Images/radar_labelbar.png".into()),
                id: 2,
            }
        ],
    };

  let config_json = json::to_string(&config);
  let mut config_file = File::create("./src/conf.json").expect("Failed to create config JSON file");
  write!(config_file, "{}", &config_json).expect("Failed to write config to JSON file");
}
