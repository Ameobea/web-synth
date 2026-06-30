use chrono::NaiveDateTime;
use diesel::prelude::*;
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  db_util::{build_tags_with_counts, get_and_create_tag_ids, last_insert_id},
  models::{
    midi_composition::*,
    tags::{EntityIdTag, TagCount},
  },
  WebSynthDbConn,
};

#[get("/midi_compositions")]
pub async fn get_midi_compositions(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<MIDICompositionDescriptor>>, String> {
  use crate::schema::{midi_compositions, midi_compositions_tags, tags};

  let (compositions, all_tags_for_compositions) = conn
    .run(
      |conn| -> QueryResult<(
        Vec<(i64, String, String, Option<i64>, Option<NaiveDateTime>, bool)>,
        Vec<EntityIdTag>,
      )> {
        let compositions = midi_compositions::table
          .select((
            midi_compositions::dsl::id,
            midi_compositions::dsl::name,
            midi_compositions::dsl::description,
            midi_compositions::dsl::user_id,
            midi_compositions::dsl::created_at,
            midi_compositions::dsl::is_featured,
          ))
          .load(conn)?;

        let all_tags_for_compositions = midi_compositions_tags::table
          .inner_join(tags::table)
          .select((
            midi_compositions_tags::dsl::midi_composition_id,
            tags::dsl::tag,
          ))
          .load(conn)?;

        Ok((compositions, all_tags_for_compositions))
      },
    )
    .await
    .map_err(|err| {
      error!("Error querying MIDI compositions from DB: {:?}", err);
      String::from("DB Error")
    })?;

  let mut tags_by_composition_id = all_tags_for_compositions
    .into_iter()
    .into_group_map_by(|tag| tag.entity_id);

  let descriptors = compositions
    .into_iter()
    .map(|(id, name, description, user_id, created_at, is_featured)| {
      let tags = tags_by_composition_id
        .remove(&id)
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.tag)
        .collect();
      MIDICompositionDescriptor {
        id,
        name,
        description,
        tags,
        user_id,
        created_at,
        is_featured,
      }
    })
    .collect_vec();

  Ok(Json(descriptors))
}

#[get("/midi_composition/<composition_id>")]
pub async fn get_midi_composition_by_id(
  conn: WebSynthDbConn,
  composition_id: i64,
) -> Result<Option<Json<SerializedMIDIEditorState>>, String> {
  use crate::schema::midi_compositions;

  let composition_json: Option<String> = conn
    .run(move |conn| {
      midi_compositions::table
        .find(composition_id)
        .select(midi_compositions::dsl::composition_json)
        .first(conn)
        .optional()
    })
    .await
    .map_err(|err| {
      error!("Error querying MIDI composition from DB: {:?}", err);
      String::from("DB Error")
    })?;

  let composition_json = match composition_json {
    Some(composition_json) => composition_json,
    None => return Ok(None),
  };
  let composition: SerializedMIDIEditorState =
    serde_json::from_str(&composition_json).map_err(|err| {
      error!("Error deserializing stored MIDI composition: {:?}", err);
      String::from("Error deserializing stored MIDI composition")
    })?;

  Ok(Some(Json(composition)))
}

#[post("/midi_compositions", data = "<composition>")]
pub async fn save_midi_composition(
  conn: WebSynthDbConn,
  composition: Json<NewMIDIComposition>,
) -> Result<(), String> {
  use crate::schema::{midi_compositions, midi_compositions_tags};

  let serialized_comp = serde_json::to_string(&composition.0.composition)
    .expect("Failed to serialize MIDI composition");
  let insertable_comp = InsertableMIDIComposition {
    name: composition.name.clone(),
    description: composition.description.clone(),
    composition_json: serialized_comp,
  };
  let tags = composition.tags.clone();

  conn
    .run(|conn| {
      conn.transaction(|conn| -> QueryResult<()> {
        diesel::insert_into(midi_compositions::table)
          .values(insertable_comp)
          .execute(conn)?;
        let created_preset_id = diesel::select(last_insert_id()).first(conn)?;

        // Insert tags
        let tag_count = tags.len();
        let tag_ids = get_and_create_tag_ids(conn, tags)?;
        assert_eq!(tag_count, tag_ids.len());

        let new_tags: Vec<NewMidiCompositionTag> = tag_ids
          .into_iter()
          .map(|tag_id| NewMidiCompositionTag {
            midi_composition_id: created_preset_id,
            tag_id,
          })
          .collect();

        diesel::insert_into(midi_compositions_tags::table)
          .values(new_tags)
          .execute(conn)?;

        Ok(())
      })
    })
    .await
    .map_err(|err| {
      error!("Error inserting MIDI composition into DB: {:?}", err);
      String::from("DB Error")
    })?;
  Ok(())
}

#[get("/midi_composition_tags")]
pub async fn get_midi_composition_tags(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<TagCount>>, String> {
  use crate::schema::{midi_compositions_tags, tags};

  build_tags_with_counts(conn, move |conn| -> QueryResult<Vec<_>> {
    midi_compositions_tags::table
      .inner_join(tags::table)
      .select((
        midi_compositions_tags::dsl::midi_composition_id,
        tags::dsl::tag,
      ))
      .load(conn)
  })
  .await
}
