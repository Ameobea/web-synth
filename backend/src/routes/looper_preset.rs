use diesel::prelude::*;
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  db_util::{
    build_tags_with_counts, get_and_create_tag_ids, last_insert_id, login::get_logged_in_user_id,
  },
  models::{
    looper_preset::{NewLooperPreset, NewLooperPresetTag, SerializedLooperInstState},
    tags::{EntityIdTag, TagCount},
    user::MaybeLoginToken,
    GenericPresetDescriptor, SaveGenericPresetRequest,
  },
  WebSynthDbConn,
};

#[get("/looper_presets")]
pub async fn get_looper_presets(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<GenericPresetDescriptor>>, String> {
  use crate::schema::{looper_presets, looper_presets_tags, tags, users};

  let (looper_presets, preset_tags) = conn
    .run(|conn| -> QueryResult<(_, _)> {
      let presets = looper_presets::table
        .left_join(users::table)
        .select((
          looper_presets::dsl::id,
          looper_presets::dsl::name,
          looper_presets::dsl::description,
          users::dsl::id.nullable(),
          users::dsl::username.nullable(),
        ))
        .load::<(i64, String, String, Option<i64>, Option<String>)>(conn)?;

      let preset_tags: Vec<EntityIdTag> = looper_presets_tags::table
        .inner_join(tags::table)
        .select((looper_presets_tags::dsl::looper_preset_id, tags::dsl::tag))
        .load(conn)?;

      Ok((presets, preset_tags))
    })
    .await
    .map_err(|err| {
      error!("DB error loading looper presets from DB: {}", err);
      String::from("DB error loading looper presets from DB")
    })?;

  let mut tags_by_preset_id = preset_tags
    .into_iter()
    .into_group_map_by(|tag| tag.entity_id);

  let looper_presets = looper_presets
    .into_iter()
    .map(|(id, name, description, user_id, user_name)| {
      let tags = tags_by_preset_id
        .remove(&id)
        .unwrap_or_default()
        .iter()
        .map(|tag| tag.tag.clone())
        .collect_vec();

      GenericPresetDescriptor {
        id,
        name,
        description,
        tags,
        user_id,
        user_name,
      }
    })
    .collect_vec();

  Ok(Json(looper_presets))
}

#[get("/looper_preset/<preset_id>")]
pub async fn get_looper_preset_by_id(
  conn: WebSynthDbConn,
  preset_id: i64,
) -> Result<Option<Json<SerializedLooperInstState>>, String> {
  use crate::schema::looper_presets;

  let serialized_looper_inst_state: Option<String> = conn
    .run(move |conn| -> QueryResult<Option<_>> {
      looper_presets::table
        .find(preset_id)
        .select(looper_presets::dsl::serialized_looper_inst_state)
        .first(conn)
        .optional()
    })
    .await
    .map_err(|err| {
      error!("DB error loading looper preset from DB: {}", err);
      String::from("DB error loading looper preset from DB")
    })?;

  let serialized_looper_inst_state = match serialized_looper_inst_state {
    Some(serialized_looper_inst_state) => serialized_looper_inst_state,
    None => return Ok(None),
  };
  let looper_inst_state: SerializedLooperInstState =
    serde_json::from_str(&serialized_looper_inst_state).map_err(|err| {
      error!("Invalid `SerializedLooperInstState` found in DB: {}", err);
      String::from("Invalid `SerializedLooperInstState` found in DB")
    })?;

  Ok(Some(Json(looper_inst_state)))
}

#[post("/looper_preset", data = "<looper_preset>")]
pub async fn create_looper_preset(
  conn: WebSynthDbConn,
  looper_preset: Json<SaveGenericPresetRequest<SerializedLooperInstState>>,
  login_token: MaybeLoginToken,
) -> Result<Json<i64>, String> {
  use crate::schema::{looper_presets, looper_presets_tags};

  let user_id = get_logged_in_user_id(&conn, login_token).await;

  let SaveGenericPresetRequest {
    preset: serialized_looper_inst_state,
    name,
    description,
    tags,
  } = looper_preset.into_inner();
  let serialized_looper_inst_state: String =
    serde_json::to_string(&serialized_looper_inst_state).unwrap();

  let created_preset_id = conn
    .run(move |conn| -> QueryResult<i64> {
      conn.transaction(move |conn| {
        diesel::insert_into(looper_presets::table)
          .values(NewLooperPreset {
            name,
            description,
            serialized_looper_inst_state,
            user_id,
          })
          .execute(conn)?;
        let created_preset_id = diesel::select(last_insert_id()).first(conn)?;

        // Insert tags
        let tag_count = tags.len();
        let tag_ids = get_and_create_tag_ids(conn, tags)?;
        assert_eq!(tag_count, tag_ids.len());

        let new_tags: Vec<NewLooperPresetTag> = tag_ids
          .into_iter()
          .map(|tag_id| NewLooperPresetTag {
            looper_preset_id: created_preset_id,
            tag_id,
          })
          .collect();

        diesel::insert_into(looper_presets_tags::table)
          .values(new_tags)
          .execute(conn)?;

        Ok(created_preset_id)
      })
    })
    .await
    .map_err(|err| {
      error!("DB error inserting looper preset into DB: {}", err);
      String::from("DB error inserting looper preset into DB")
    })?;

  Ok(Json(created_preset_id))
}

#[get("/looper_preset_tags")]
pub async fn get_looper_preset_tags(conn: WebSynthDbConn) -> Result<Json<Vec<TagCount>>, String> {
  use crate::schema::{looper_presets_tags, tags};

  build_tags_with_counts(conn, move |conn| -> QueryResult<Vec<_>> {
    looper_presets_tags::table
      .inner_join(tags::table)
      .select((looper_presets_tags::dsl::looper_preset_id, tags::dsl::tag))
      .load(conn)
  })
  .await
}
