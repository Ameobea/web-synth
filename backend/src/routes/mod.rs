use std::collections::HashMap;

use diesel::{self, prelude::*};
use rocket::serde::json::Json;

use crate::{
    models::{
        compositions::{Composition, NewComposition, NewCompositionRequest},
        effects::{Effect, InsertableEffect},
        synth_preset::{
            InlineSynthPreset, InlineSynthPresetEntry, NewSynthPresetEntry,
            NewSynthVoicePresetEntry, ReceivedSynthPresetEntry, SynthPreset, SynthVoicePresetEntry,
            UserProvidedNewSynthVoicePreset, VoiceDefinition,
        },
    },
    schema, WebSynthDbConn,
};

pub mod midi_composition;
mod remote_samples;
pub use self::{midi_composition::*, remote_samples::*};

#[get("/")]
pub fn index() -> &'static str {
    warn!("TEST");
    info!("TEST");
    "Application successfully started!"
}

#[post("/effects", data = "<effect>")]
pub async fn create_effect(
    conn: WebSynthDbConn,
    effect: Json<InsertableEffect>,
) -> Result<String, String> {
    let inserted_rows = conn
        .run(move |conn| {
            diesel::insert_into(schema::effects::table)
                .values(&effect.0)
                .execute(conn)
        })
        .await
        .map_err(|err| -> String {
            error!("Error inserting row: {:?}", err);
            "Error inserting row into database".into()
        })?;

    Ok(format!("Inserted {} row(s).", inserted_rows))
}

#[get("/effects")]
pub async fn list_effects(conn: WebSynthDbConn) -> Result<Json<Vec<Effect>>, String> {
    use crate::schema::effects::dsl::*;

    let all_effects = conn.run(|conn| effects.load(conn)).await.map_err(|err| {
        error!("Error querying effects: {:?}", err);
        "Error querying effects from the database".to_string()
    })?;
    Ok(Json(all_effects))
}

#[post("/compositions", data = "<composition>")]
pub async fn save_composition(
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

    let inserted_rows = conn
        .run(move |conn| {
            diesel::insert_into(schema::compositions::table)
                .values(&new_composition)
                .execute(conn)
        })
        .await
        .map_err(|err| -> String {
            error!("Error inserting row: {:?}", err);
            "Error inserting row into database".into()
        })?;

    Ok(format!("Inserted {} row(s).", inserted_rows))
}

#[get("/compositions/<composition_id>")]
pub async fn get_composition_by_id(
    conn: WebSynthDbConn,
    composition_id: i64,
) -> Result<Option<Json<Composition>>, String> {
    use crate::schema::compositions::dsl::*;

    let composition_opt = match conn
        .run(move |conn| compositions.find(composition_id).first::<Composition>(conn))
        .await
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
pub async fn get_compositions(conn: WebSynthDbConn) -> Result<Json<Vec<Composition>>, String> {
    use crate::schema::compositions::dsl::*;

    let all_compos = conn
        .run(|conn| compositions.load(conn))
        .await
        .map_err(|err| {
            error!("Error querying compositions: {:?}", err);
            "Error querying compositions from the database".to_string()
        })?;
    Ok(Json(all_compos))
}

#[get("/synth_presets")]
pub async fn get_synth_presets(
    conn0: WebSynthDbConn,
    conn1: WebSynthDbConn,
) -> Result<Json<Vec<InlineSynthPresetEntry>>, String> {
    use crate::schema::{synth_presets, voice_presets};

    let (synth_presets_, voice_presets_): (
        Vec<(i64, String, String, String)>,
        Vec<(i64, String, String, String)>,
    ) = tokio::try_join!(
        conn0.run(|conn| {
            synth_presets::table
                .select((
                    synth_presets::id,
                    synth_presets::title,
                    synth_presets::description,
                    synth_presets::body,
                ))
                .load(conn)
                .map_err(|err| {
                    error!("Error querying synth presets: {:?}", err);
                    "Error querying synth presets from the database".to_string()
                })
        }),
        conn1.run(|conn| {
            voice_presets::table
                .select((
                    voice_presets::id,
                    voice_presets::title,
                    voice_presets::description,
                    voice_presets::body,
                ))
                .load(conn)
                .map_err(|err| {
                    error!("Error querying synth voice presets: {:?}", err);
                    "Error querying synth voice presets from the database".to_string()
                })
        }),
    )?;

    // build a mapping of voice preset id to voice preset
    let mut voice_presets_by_id: HashMap<i64, SynthVoicePresetEntry> = HashMap::new();
    for (id_, title_, description_, body_) in voice_presets_ {
        let body_ = serde_json::from_str(&body_).map_err(|err| -> String {
            error!("Error parsing voice preset entry stored in DB: {:?}", err);
            "Error parsing voice preset entry stored in DB".into()
        })?;

        let voice_preset = SynthVoicePresetEntry {
            id: id_,
            title: title_,
            description: description_,
            body: body_,
        };

        voice_presets_by_id.insert(voice_preset.id, voice_preset);
    }

    Ok(
        Json(
            synth_presets_
                .into_iter()
                .map(
                    |(synth_preset_id, title_, description_, body_)|
                     -> Result<InlineSynthPresetEntry, String> {
                        let body_: SynthPreset =
                            serde_json::from_str(&body_).map_err(|err| -> String {
                                error!("Invalid synth preset body provided: {:?}", err);
                                "Invalid synth preset body provided".into()
                            })?;
                        let inlined_body = InlineSynthPreset {
                            voices: body_.voices,
                        };
                        Ok(InlineSynthPresetEntry {
                            id: synth_preset_id,
                            title: title_,
                            description: description_,
                            body: inlined_body,
                        })
                    },
                )
                .collect::<Result<Vec<_>, String>>()?,
        ),
    )
}

#[post("/synth_presets", data = "<preset>")]
pub async fn create_synth_preset(
    conn: WebSynthDbConn,
    preset: Json<ReceivedSynthPresetEntry>,
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

    conn.run(move |conn| {
        diesel::insert_into(synth_presets)
            .values(&entry)
            .execute(conn)
    })
    .await
    .map_err(|err| -> String {
        error!("Error inserting synth preset into database: {:?}", err);
        "Error inserting synth preset into database".into()
    })
    .map(drop)
}

#[get("/synth_voice_presets")]
pub async fn get_synth_voice_presets(
    conn: WebSynthDbConn,
) -> Result<Json<Vec<SynthVoicePresetEntry>>, String> {
    use crate::schema::voice_presets::dsl::*;

    let all_presets = conn
        .run(|conn| {
            voice_presets
                .select((id, title, description, body))
                .load(conn)
        })
        .await
        .map_err(|err| {
            error!("Error querying synth presets: {:?}", err);
            "Error querying synth presets from the database".to_string()
        })?;
    let all_presets: Vec<SynthVoicePresetEntry> = all_presets
        .into_iter()
        .map(
            |(id_, title_, description_, body_): (i64, String, String, String)| {
                let preset: VoiceDefinition =
                    serde_json::from_str(&body_).map_err(|err| -> String {
                        let err_msg = format!("Error parsing provided synth definition: {:?}", err);
                        error!("{}", err_msg);
                        err_msg
                    })?;
                Ok(SynthVoicePresetEntry {
                    id: id_,
                    title: title_,
                    description: description_,
                    body: preset,
                })
            },
        )
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Json(all_presets))
}

#[post("/synth_voice_presets", data = "<voice_preset>")]
pub async fn create_synth_voice_preset(
    conn: WebSynthDbConn,
    voice_preset: Json<UserProvidedNewSynthVoicePreset>,
) -> Result<(), String> {
    use crate::schema::voice_presets::dsl::*;

    let body_: String = serde_json::to_string(&voice_preset.0.body).map_err(|err| -> String {
        let err_msg = format!("Error parsing provided synth preset body: {:?}", err);
        error!("{}", err_msg);
        err_msg
    })?;
    let entry = NewSynthVoicePresetEntry {
        title: voice_preset.0.title,
        description: voice_preset.0.description,
        body: body_,
    };

    conn.run(move |conn| {
        diesel::insert_into(voice_presets)
            .values(&entry)
            .execute(conn)
    })
    .await
    .map_err(|err| -> String {
        error!("Error inserting synth preset into database: {:?}", err);
        "Error inserting synth preset into database".into()
    })
    .map(drop)
}
