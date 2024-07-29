use diesel::{prelude::*, QueryResult};
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  db_util::{
    build_tags_with_counts, get_and_create_tag_ids, last_insert_id, login::get_logged_in_user_id,
  },
  models::{
    tags::{EntityIdTag, TagCount},
    user::MaybeLoginToken,
    wavetable_preset::{
      NewWavetablePreset, NewWavetablePresetTag, SaveWavetablePresetRequest,
      SerializedWavetableInstState, WavetablePreset, WavetablePresetDescriptor,
    },
  },
  WebSynthDbConn,
};

#[get("/wavetable_presets")]
pub async fn get_wavetable_presets(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<WavetablePresetDescriptor>>, String> {
  let (wavetable_presets, preset_tags) = conn
    .run(|conn| -> QueryResult<(_, _)> {
      use crate::schema::{tags, users, wavetable_presets, wavetable_presets_tags};

      let presets = wavetable_presets::table
        .left_join(users::table)
        .select((
          wavetable_presets::dsl::id,
          wavetable_presets::dsl::name,
          wavetable_presets::dsl::description,
          users::dsl::id.nullable(),
          users::dsl::username.nullable(),
        ))
        .load::<(i64, String, String, Option<i64>, Option<String>)>(conn)?;

      let preset_tags: Vec<EntityIdTag> = wavetable_presets_tags::table
        .inner_join(tags::table)
        .select((
          wavetable_presets_tags::dsl::wavetable_preset_id,
          tags::dsl::tag,
        ))
        .load(conn)?;

      Ok((presets, preset_tags))
    })
    .await
    .map_err(|err| {
      error!("DB error loading wavetable presets from DB: {}", err);
      String::from("DB error loading wavetable presets from DB")
    })?;

  let mut tags_by_preset_id = preset_tags
    .into_iter()
    .into_group_map_by(|tag| tag.entity_id);

  let wavetable_presets = wavetable_presets
    .into_iter()
    .map(|(id, name, description, user_id, user_name)| {
      let tags = tags_by_preset_id
        .remove(&id)
        .unwrap_or_default()
        .iter()
        .map(|tag| tag.tag.clone())
        .collect_vec();

      WavetablePresetDescriptor {
        id,
        name,
        description,
        tags,
        user_id,
        user_name,
      }
    })
    .collect_vec();

  Ok(Json(wavetable_presets))
}

#[get("/wavetable_preset/<preset_id>")]
pub async fn get_wavetable_preset_by_id(
  conn: WebSynthDbConn,
  preset_id: i64,
) -> Result<Option<Json<SerializedWavetableInstState>>, String> {
  let preset = conn
    .run(move |conn| {
      use crate::schema::wavetable_presets::dsl::*;

      wavetable_presets
        .filter(id.eq(preset_id))
        .first::<WavetablePreset>(conn)
        .optional()
    })
    .await
    .map_err(|err| {
      error!("DB error loading wavetable preset from DB: {}", err);
      String::from("DB error loading wavetable preset from DB")
    })?;

  let preset = match preset {
    Some(preset) =>
      serde_json::from_str::<SerializedWavetableInstState>(&preset.serialized_wavetable_inst_state)
        .map_err(|err| {
          error!("Error deserializing wavetable preset: {}", err);
          String::from("Error deserializing wavetable preset")
        })?,
    None => return Ok(None),
  };

  Ok(Some(Json(preset)))
}

#[post("/wavetable_preset", data = "<wavetable_preset>")]
pub async fn create_wavetable_preset(
  conn: WebSynthDbConn,
  wavetable_preset: Json<SaveWavetablePresetRequest>,
  login_token: MaybeLoginToken,
) -> Result<Json<i64>, String> {
  let SaveWavetablePresetRequest {
    name,
    description,
    tags,
    serialized_wavetable_inst_state,
  } = wavetable_preset.into_inner();

  let user_id = get_logged_in_user_id(&conn, login_token).await;

  let created_preset_id = conn
    .run(move |conn| -> QueryResult<i64> {
      use crate::schema::{wavetable_presets, wavetable_presets_tags};

      conn.transaction(move |conn| {
        diesel::insert_into(wavetable_presets::table)
          .values(NewWavetablePreset {
            name,
            description,
            serialized_wavetable_inst_state: serde_json::to_string(
              &serialized_wavetable_inst_state,
            )
            .unwrap(),
            user_id,
          })
          .execute(conn)?;
        let created_preset_id = diesel::select(last_insert_id()).first(conn)?;

        // Insert tags
        let tag_count = tags.len();
        let tag_ids = get_and_create_tag_ids(conn, tags)?;
        assert_eq!(tag_count, tag_ids.len());

        let new_tags: Vec<NewWavetablePresetTag> = tag_ids
          .into_iter()
          .map(|tag_id| NewWavetablePresetTag {
            wavetable_preset_id: created_preset_id,
            tag_id,
          })
          .collect();

        diesel::insert_into(wavetable_presets_tags::table)
          .values(new_tags)
          .execute(conn)?;

        Ok(created_preset_id)
      })
    })
    .await
    .map_err(|err| {
      error!("DB error inserting wavetable preset into DB: {}", err);
      String::from("DB error inserting wavetable preset into DB")
    })?;

  Ok(Json(created_preset_id))
}

#[get("/wavetable_preset_tags")]
pub async fn get_wavetable_preset_tags(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<TagCount>>, String> {
  use crate::schema::{tags, wavetable_presets_tags};

  build_tags_with_counts(conn, move |conn| -> QueryResult<Vec<_>> {
    wavetable_presets_tags::table
      .inner_join(tags::table)
      .select((
        wavetable_presets_tags::dsl::wavetable_preset_id,
        tags::dsl::tag,
      ))
      .load(conn)
  })
  .await
}
