use std::collections::HashMap;

use diesel::{self, prelude::*};
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
    db_util::{
        build_tags_with_counts, get_and_create_tag_ids, last_insert_id,
        login::get_logged_in_user_id,
    },
    models::{
        compositions::{
            Composition, CompositionDescriptor, NewComposition, NewCompositionRequest,
            NewCompositionTag,
        },
        effects::{Effect, InsertableEffect},
        synth_preset::{
            InlineSynthPreset, InlineSynthPresetEntry, NewSynthPresetEntry,
            NewSynthVoicePresetEntry, ReceivedSynthPresetEntry, SynthPreset, SynthVoicePresetEntry,
            UserProvidedNewSynthVoicePreset, VoiceDefinition,
        },
        tags::{EntityIdTag, TagCount},
        user::MaybeLoginToken,
    },
    schema, WebSynthDbConn,
};

mod looper_preset;
pub mod midi_composition;
mod remote_samples;
pub use self::{looper_preset::*, midi_composition::*, remote_samples::*};
pub mod login;
mod wavetable_preset;
pub use self::wavetable_preset::*;

#[get("/")]
pub fn index() -> &'static str { "Application successfully started!" }

#[post("/effects", data = "<effect>")]
pub async fn create_effect(
    conn: WebSynthDbConn,
    mut effect: Json<InsertableEffect>,
    maybe_login_token: MaybeLoginToken,
) -> Result<String, String> {
    let user_id = get_logged_in_user_id(&conn, maybe_login_token).await;
    effect.0.user_id = user_id;

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
    use crate::schema::{effects, users};

    let all_effects = conn
        .run(|conn| {
            effects::table
                .left_join(users::table)
                .select((
                    effects::id,
                    effects::title,
                    effects::description,
                    effects::code,
                    effects::user_id,
                    users::username.nullable(),
                ))
                .load(conn)
        })
        .await
        .map_err(|err| {
            error!("Error querying effects: {:?}", err);
            "Error querying effects from the database".to_string()
        })?;
    Ok(Json(all_effects))
}

#[post("/compositions", data = "<composition>")]
pub async fn save_composition(
    conn: WebSynthDbConn,
    mut composition: Json<NewCompositionRequest>,
    login_token: MaybeLoginToken,
) -> Result<Json<i64>, String> {
    let user_id = get_logged_in_user_id(&conn, login_token).await;
    let new_composition = NewComposition {
        title: composition.0.title,
        description: composition.0.description,
        content: serde_json::to_string(&composition.0.content).map_err(|err| {
            error!("Failed to serialize composition to JSON string: {:?}", err);
            format!("Failed to serialize composition to JSON string")
        })?,
        user_id,
    };
    let tags: Vec<String> = std::mem::take(&mut composition.0.tags);

    let saved_composition_id = conn
        .run(move |conn| {
            conn.transaction(|| -> QueryResult<i64> {
                diesel::insert_into(schema::compositions::table)
                    .values(&new_composition)
                    .execute(conn)?;

                let saved_comp_id = diesel::select(last_insert_id).first(conn)?;

                // Insert tags
                let tag_count = tags.len();
                let tag_ids = get_and_create_tag_ids(conn, tags)?;
                assert_eq!(tag_count, tag_ids.len());

                let new_tags: Vec<NewCompositionTag> = tag_ids
                    .into_iter()
                    .map(|tag_id| NewCompositionTag {
                        composition_id: saved_comp_id,
                        tag_id,
                    })
                    .collect();

                diesel::insert_into(schema::compositions_tags::table)
                    .values(new_tags)
                    .execute(conn)?;

                Ok(saved_comp_id)
            })
        })
        .await
        .map_err(|err| -> String {
            error!("Error inserting row: {:?}", err);
            "Error inserting row into database".into()
        })?;

    info!(
        "Successfully saved new composition with id={}",
        saved_composition_id
    );
    Ok(Json(saved_composition_id))
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
pub async fn get_compositions(
    conn: WebSynthDbConn,
) -> Result<Json<Vec<CompositionDescriptor>>, String> {
    use crate::schema::{compositions, compositions_tags, tags, users};

    let (all_compos, all_compos_tags) = conn
        .run(
            |conn| -> QueryResult<(Vec<(_, _, _, _, _)>, Vec<EntityIdTag>)> {
                let all_compos = compositions::table
                    .left_join(
                        users::table.on(compositions::dsl::user_id.eq(users::dsl::id.nullable())),
                    )
                    .select((
                        compositions::dsl::id,
                        compositions::dsl::title,
                        compositions::dsl::description,
                        compositions::dsl::user_id,
                        users::dsl::username.nullable(),
                    ))
                    .load(conn)?;

                let all_compos_tags: Vec<EntityIdTag> = compositions_tags::table
                    .inner_join(tags::table)
                    .select((compositions_tags::dsl::composition_id, tags::dsl::tag))
                    .load(conn)?;
                Ok((all_compos, all_compos_tags))
            },
        )
        .await
        .map_err(|err| {
            error!("Error querying compositions: {:?}", err);
            "Error querying compositions from the database".to_string()
        })?;

    let mut tags_by_compo_id = all_compos_tags
        .into_iter()
        .into_group_map_by(|tag| tag.entity_id);

    let all_compos = all_compos
        .into_iter()
        .map(|(id, title, description, user_id, user_name)| {
            let tags = tags_by_compo_id
                .remove(&id)
                .unwrap_or_default()
                .iter()
                .map(|tag| tag.tag.clone())
                .collect_vec();

            CompositionDescriptor {
                id,
                title,
                description,
                tags,
                user_id,
                user_name,
            }
        })
        .collect_vec();

    Ok(Json(all_compos))
}

#[get("/composition_tags")]
pub async fn get_composition_tags(conn: WebSynthDbConn) -> Result<Json<Vec<TagCount>>, String> {
    use crate::schema::{compositions_tags, tags};

    build_tags_with_counts(conn, move |conn| -> QueryResult<Vec<_>> {
        compositions_tags::table
            .inner_join(tags::table)
            .select((compositions_tags::dsl::composition_id, tags::dsl::tag))
            .load(conn)
    })
    .await
}

#[get("/synth_presets")]
pub async fn get_synth_presets(
    conn0: WebSynthDbConn,
    conn1: WebSynthDbConn,
) -> Result<Json<Vec<InlineSynthPresetEntry>>, String> {
    use crate::schema::{synth_presets, voice_presets};

    let (synth_presets_, voice_presets_): (
        Vec<(i64, String, String, String, Option<i64>)>,
        Vec<(i64, String, String, String, Option<i64>)>,
    ) = tokio::try_join!(
        conn0.run(|conn| {
            synth_presets::table
                .select((
                    synth_presets::id,
                    synth_presets::title,
                    synth_presets::description,
                    synth_presets::body,
                    synth_presets::user_id,
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
                    voice_presets::user_id,
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
    for (id_, title_, description_, body_, user_id_) in voice_presets_ {
        let body_ = serde_json::from_str(&body_).map_err(|err| -> String {
            error!("Error parsing voice preset entry stored in DB: {:?}", err);
            "Error parsing voice preset entry stored in DB".into()
        })?;

        let voice_preset = SynthVoicePresetEntry {
            id: id_,
            title: title_,
            description: description_,
            body: body_,
            user_id: user_id_,
        };

        voice_presets_by_id.insert(voice_preset.id, voice_preset);
    }

    Ok(
        Json(
            synth_presets_
                .into_iter()
                .map(
                    |(synth_preset_id, title_, description_, body_, user_id_)|
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
                            user_id: user_id_,
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
    login_token: MaybeLoginToken,
) -> Result<(), String> {
    use crate::schema::synth_presets::dsl::*;

    let user_id_ = get_logged_in_user_id(&conn, login_token).await;

    let body_: String = serde_json::to_string(&preset.body).map_err(|err| -> String {
        let err_msg = format!("Error parsing provided synth preset body: {:?}", err);
        error!("{}", err_msg);
        err_msg
    })?;
    let entry = NewSynthPresetEntry {
        title: preset.0.title,
        description: preset.0.description,
        body: body_,
        user_id: user_id_,
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
                .select((id, title, description, body, user_id))
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
            |(id_, title_, description_, body_, user_id_): (
                i64,
                String,
                String,
                String,
                Option<i64>,
            )| {
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
                    user_id: user_id_,
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
    login_token: MaybeLoginToken,
) -> Result<(), String> {
    use crate::schema::voice_presets::dsl::*;

    let user_id_ = get_logged_in_user_id(&conn, login_token).await;

    let body_: String = serde_json::to_string(&voice_preset.0.body).map_err(|err| -> String {
        let err_msg = format!("Error parsing provided synth preset body: {:?}", err);
        error!("{}", err_msg);
        err_msg
    })?;
    let entry = NewSynthVoicePresetEntry {
        title: voice_preset.0.title,
        description: voice_preset.0.description,
        body: body_,
        user_id: user_id_,
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
