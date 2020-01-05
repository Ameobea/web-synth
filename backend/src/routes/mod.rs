use diesel::{self, prelude::*};

use crate::{
    models::{
        compositions::{Composition, NewComposition, NewCompositionRequest},
        effects::{Effect, InsertableEffect},
        synth_preset::{NewSynthPresetEntry, SynthPreset, SynthPresetEntry},
    },
    schema, WebSynthDbConn,
};
use rocket_contrib::json::Json;

#[get("/")]
pub fn index() -> &'static str { "Application successfully started!" }

#[post("/effects", data = "<effect>")]
pub fn create_effect(
    conn: WebSynthDbConn,
    effect: Json<InsertableEffect>,
) -> Result<String, String> {
    let inserted_rows = diesel::insert_into(schema::effects::table)
        .values(&effect.0)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting row: {:?}", err);
            "Error inserting row into database".into()
        })?;

    Ok(format!("Inserted {} row(s).", inserted_rows))
}

#[get("/effects")]
pub fn list_effects(conn: WebSynthDbConn) -> Result<Json<Vec<Effect>>, String> {
    use crate::schema::effects::dsl::*;

    Ok(Json(effects.load(&conn.0).map_err(|err| {
        error!("Error querying effects: {:?}", err);
        "Error querying effects from the database".to_string()
    })?))
}

#[post("/compositions", data = "<composition>")]
pub fn save_composition(
    conn: WebSynthDbConn,
    composition: Json<NewCompositionRequest>,
) -> Result<String, String> {
    let new_composition = NewComposition {
        author: 0, // TODO: Make dynamic once user system is in place
        title: composition.0.title,
        description: composition.0.description,
        content: serde_json::to_string(&composition.0.content).map_err(|err| {
            error!("Failed to serialize composition to JSON string: {:?}", err);
            format!("Failed to serialize composition to JSON string")
        })?,
    };

    let inserted_rows = diesel::insert_into(schema::compositions::table)
        .values(&new_composition)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting row: {:?}", err);
            "Error inserting row into database".into()
        })?;

    Ok(format!("Inserted {} row(s).", inserted_rows))
}

#[get("/compositions/<composition_id>")]
pub fn get_composition_by_id(
    conn: WebSynthDbConn,
    composition_id: i64,
) -> Result<Option<Json<Composition>>, String> {
    use crate::schema::compositions::dsl::*;

    let composition_opt = match compositions
        .find(composition_id)
        .first::<Composition>(&conn.0)
    {
        Ok(composition) => Some(Json(composition)),
        Err(diesel::NotFound) => None,
        Err(err) => {
            error!("Error querying composition by id: {:?}", err);
            return Err("Error querying composition by id from the database".to_string());
        },
    };

    Ok(composition_opt)
}

#[get("/compositions")]
pub fn get_compositions(conn: WebSynthDbConn) -> Result<Json<Vec<Composition>>, String> {
    use crate::schema::compositions::dsl::*;

    Ok(Json(compositions.load(&conn.0).map_err(|err| {
        error!("Error querying compositions: {:?}", err);
        "Error querying compositions from the database".to_string()
    })?))
}

#[get("/synth_presets")]
pub fn get_synth_presets(conn: WebSynthDbConn) -> Result<Json<Vec<SynthPresetEntry>>, String> {
    use crate::schema::synth_presets::dsl::*;

    Ok(Json(
        synth_presets
            .select((title, description, body))
            .load(&conn.0)
            .map_err(|err| {
                error!("Error querying synth presets: {:?}", err);
                "Error querying synth presets from the database".to_string()
            })
            .and_then(|items| -> Result<Vec<SynthPresetEntry>, String> {
                items
                    .into_iter()
                    .map(|(title_, description_, body_): (String, String, String)| -> Result<SynthPresetEntry,String> {
                        let body_: SynthPreset = serde_json::from_str(&body_).map_err(|err| ->String{
                            error!("Invalid synth preset body provided: {:?}",err);
                            "Invalid synth preset body provided".into()
                        })?;
                        Ok(SynthPresetEntry {
                            title: title_,
                            description: description_,
                            body: body_,
                        })
                    })
                    .collect::<Result<Vec<_>, String>>()
            })?,
    ))
}

#[post("/synth_presets", data = "<preset>")]
pub fn create_synth_preset(
    conn: WebSynthDbConn,
    preset: Json<SynthPresetEntry>,
) -> Result<(), String> {
    use crate::schema::synth_presets::dsl::*;

    let body_: String = serde_json::to_string(&preset.body).map_err(|err| -> String {
        let err_msg = format!("Error parsing provided synth preset body: {:?}", err);
        error!("{}", err_msg);
        err_msg
    })?;
    let entry = NewSynthPresetEntry {
        title: preset.0.title,
        description: preset.0.description,
        body: body_,
    };

    diesel::insert_into(synth_presets)
        .values(&entry)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting synth preset into database: {:?}", err);
            "Error inserting synth preset into database".into()
        })
        .map(|_| ())
}
