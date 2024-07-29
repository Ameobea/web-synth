use diesel::{self, prelude::*};
use fxhash::FxHashMap;
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  db_util::{
    build_tags_with_counts, get_and_create_tag_ids, last_insert_id, login::get_logged_in_user_id,
  },
  models::{
    compositions::{
      Composition, CompositionDescriptor, CompositionVersion, NewComposition,
      NewCompositionRequest, NewCompositionTag,
    },
    effects::{Effect, InsertableEffect},
    synth_preset::{
      InlineSynthPreset, InlineSynthPresetEntry, NewSynthPresetEntry, NewSynthVoicePresetEntry,
      ReceivedSynthPresetEntry, SynthPreset, SynthVoicePresetEntry,
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
mod subgraph_preset;
pub use self::subgraph_preset::*;

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

  // if adding a version to an existing composition, the user must be logged in and own the parent
  let (parent_id, composition_version) = if let Some(parent_id) = composition.0.parent_id {
    let Some(user_id) = user_id else {
      return Err("User must be logged in to save a new version of a composition".to_owned());
    };

    let (id, parent_id) = match conn
      .run(
        move |conn| -> QueryResult<Option<(i64, Option<i64>, Option<i64>)>> {
          schema::compositions::table
            .filter(schema::compositions::dsl::id.eq(parent_id))
            .select((
              schema::compositions::dsl::id,
              schema::compositions::dsl::parent_id,
              schema::compositions::dsl::user_id,
            ))
            .order_by(schema::compositions::dsl::composition_version.asc())
            .first(conn)
            .optional()
        },
      )
      .await
    {
      Ok(Some((id, parent_id, parent_user_id))) => {
        if parent_user_id != Some(user_id) {
          return Err("User does not own the parent composition".to_owned());
        }

        (id, parent_id)
      },
      Ok(None) => return Err("Parent composition not found".to_owned()),
      Err(err) => {
        error!("Error querying parent composition: {:?}", err);
        return Err("Error querying parent composition from the database".to_owned());
      },
    };

    let root_parent_id = parent_id.unwrap_or(id);
    let latest_version: Option<i32> = conn
      .run(move |conn| {
        schema::compositions::table
          .filter(schema::compositions::dsl::parent_id.eq(Some(root_parent_id)))
          .select(diesel::dsl::max(
            schema::compositions::dsl::composition_version,
          ))
          .first::<Option<i32>>(conn)
      })
      .await
      .map_err(|err| {
        error!("Error querying composition version: {:?}", err);
        "Error querying composition version from the database".to_owned()
      })?;

    (Some(root_parent_id), latest_version.unwrap_or(0) + 1)
  } else {
    (None, 0)
  };

  let new_composition = NewComposition {
    title: composition.0.title,
    description: composition.0.description,
    content: serde_json::to_string(&composition.0.content).map_err(|err| {
      error!("Failed to serialize composition to JSON string: {:?}", err);
      format!("Failed to serialize composition to JSON string")
    })?,
    user_id,
    composition_version,
    parent_id,
  };
  let tags: Vec<String> = if new_composition.parent_id.is_none() {
    std::mem::take(&mut composition.0.tags)
  } else {
    Vec::new()
  };

  let saved_composition_id = conn
    .run(move |conn| {
      conn.transaction(|conn| -> QueryResult<i64> {
        diesel::insert_into(schema::compositions::table)
          .values(&new_composition)
          .execute(conn)?;

        let saved_comp_id = diesel::select(last_insert_id()).first(conn)?;

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

async fn query_composition_by_id(
  conn: WebSynthDbConn,
  composition_id: i64,
) -> QueryResult<Option<Composition>> {
  use crate::schema::compositions;

  conn
    .run(move |conn| {
      compositions::table
        .filter(
          compositions::dsl::id
            .eq(composition_id)
            .or(compositions::dsl::parent_id.eq(composition_id)),
        )
        .order_by(compositions::dsl::composition_version.desc())
        .first::<Composition>(conn)
        .optional()
    })
    .await
}

#[get("/compositions/<composition_id>")]
pub async fn get_composition_by_id(
  conn: WebSynthDbConn,
  composition_id: i64,
) -> Result<Option<Json<Composition>>, String> {
  query_composition_by_id(conn, composition_id)
    .await
    .map_err(|err| {
      error!("Error querying composition: {:?}", err);
      "Error querying composition from the database".to_string()
    })
    .map(|comp| comp.map(Json))
}

#[get("/compositions")]
pub async fn get_compositions(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<CompositionDescriptor>>, String> {
  use crate::schema::{compositions, compositions_tags, tags, users};

  let (all_compos, all_compos_tags) = conn
    .run(
      |conn| -> QueryResult<(Vec<(_, _, _, _, Option<i64>, i32, _, _)>, Vec<EntityIdTag>)> {
        let all_compos = compositions::table
          .left_join(users::table.on(compositions::dsl::user_id.eq(users::dsl::id.nullable())))
          .select((
            compositions::dsl::id,
            compositions::dsl::title,
            compositions::dsl::description,
            compositions::dsl::user_id,
            compositions::dsl::parent_id,
            compositions::dsl::composition_version,
            compositions::dsl::created_at,
            users::dsl::username.nullable(),
          ))
          .order_by(compositions::dsl::id.asc())
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
      error!("Error querying compositions: {err:?}");
      "Error querying compositions from the database".to_string()
    })?;

  let mut tags_by_compo_id = all_compos_tags
    .into_iter()
    .into_group_map_by(|tag| tag.entity_id);

  let mut compositions_by_root_id: FxHashMap<i64, CompositionDescriptor> = FxHashMap::default();

  for (id, title, description, user_id, parent_id, composition_version, created_at, user_name) in
    all_compos
  {
    if let Some(parent_id) = parent_id {
      let Some(parent) = compositions_by_root_id.get_mut(&parent_id) else {
        error!(
          "Composition with parent_id={parent_id} not found; versions should have been ordered \
           after the parent"
        );
        continue;
      };

      parent.versions.push(CompositionVersion {
        id,
        title,
        description,
        composition_version,
        created_at,
      });

      continue;
    }

    let tags = tags_by_compo_id
      .remove(&id)
      .unwrap_or_default()
      .iter()
      .map(|tag| tag.tag.clone())
      .collect_vec();

    let descriptor = CompositionDescriptor {
      id,
      title,
      description,
      tags,
      user_id,
      user_name,
      versions: Vec::new(),
      created_at,
    };
    compositions_by_root_id.insert(id, descriptor);
  }

  let mut all_compos = compositions_by_root_id.into_values().collect_vec();
  all_compos.sort_unstable_by_key(|comp| comp.id);

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
  let mut voice_presets_by_id: FxHashMap<i64, SynthVoicePresetEntry> = FxHashMap::default();
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

  let presets = synth_presets_
        .into_iter()
        .map(
            |(synth_preset_id, title_, description_, body_, user_id_)| -> Result<InlineSynthPresetEntry, String> {
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
        .collect::<Result<Vec<_>, String>>()?;

  Ok(Json(presets))
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

  conn
    .run(move |conn| {
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
      |(id_, title_, description_, body_, user_id_): (i64, String, String, String, Option<i64>)| {
        let preset: VoiceDefinition = serde_json::from_str(&body_).map_err(|err| -> String {
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

  conn
    .run(move |conn| {
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
