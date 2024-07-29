use std::{
  io::Cursor,
  path::{Path, PathBuf},
};

use diesel::prelude::*;
use rocket::{data::ToByteUnit, serde::json::Json};
use sha2::{Digest, Sha256};

use crate::{
  db_util::{
    login::validate_login_token, private_sample_libraries::get_private_sample_libraries_for_user,
  },
  models::{remote_samples::RemoteSample, user::MaybeLoginToken},
  WebSynthDbConn,
};

const FAUST_SERVER_URL: &str = "https://faust-compiler.ameo.design";
// const FAUST_SERVER_URL: &str = "http://localhost:4565";
const REMOTE_SAMPLES_BUCKET_URL: &str = "https://storage.googleapis.com/web-synth-remote-samples/";

#[get("/remote_samples")]
pub async fn list_remote_samples(
  conn: WebSynthDbConn,
  conn2: WebSynthDbConn,
  login_token_opt: MaybeLoginToken,
) -> Result<Json<Vec<RemoteSample>>, String> {
  use crate::schema::remote_sample_urls;

  let user_id = if let Some(login_token) = login_token_opt.0 {
    match validate_login_token(&conn, login_token).await {
      Ok(user_id) => user_id,
      Err(err) => {
        error!("Error validating login token: {}", err);
        None
      },
    }
  } else {
    None
  };
  let private_samples_rx = if let Some(user_id) = user_id {
    let (tx, rx) = tokio::sync::oneshot::channel();
    tokio::task::spawn(async move {
      let private_sample_libraries =
        match get_private_sample_libraries_for_user(conn2, user_id).await {
          Ok(private_samples) => private_samples,
          Err(err) => {
            error!(
              "Error getting private samples for user {}: {:?}",
              user_id, err
            );
            let _ = tx.send(Vec::new());
            return;
          },
        };
      info!(
        "Found {} private sample libraries for user {}",
        private_sample_libraries.len(),
        user_id
      );

      let mut remote_samples = Vec::new();
      for lib in private_sample_libraries {
        let samples_for_library = match lib.list_remote_samples().await {
          Ok(samples) => samples,
          Err(err) => {
            error!(
              "Error listing remote samples for private sample library {}, user {}: {:?}",
              lib.id, user_id, err
            );
            continue;
          },
        };
        remote_samples.extend(samples_for_library);
      }
      info!(
        "Got {} remote samples for user {}",
        remote_samples.len(),
        user_id
      );
      let _ = tx.send(remote_samples);
    });
    Some(rx)
  } else {
    drop(conn2);
    None
  };

  let mut all_remote_samples: Vec<RemoteSample> = conn
    .run(|conn| remote_sample_urls::table.load(conn))
    .await
    .map_err(|err| {
      error!("Error querying DB for remote samples: {:?}", err);
      String::from("DB error")
    })?;

  if let Some(private_samples_rx) = private_samples_rx {
    let private_samples = private_samples_rx.await.unwrap_or_else(|err| {
      error!("Error getting private samples: {:?}", err);
      Vec::new()
    });
    all_remote_samples.extend(private_samples);
  }

  all_remote_samples.retain(|s| !s.name.to_ascii_lowercase().contains(".ds_store"));

  Ok(Json(all_remote_samples))
}

fn encode_to_wav(sample_data: Vec<u8>) -> Result<Vec<u8>, String> {
  let spec = hound::WavSpec {
    channels: 1,
    sample_rate: 44100,
    bits_per_sample: 32,
    sample_format: hound::SampleFormat::Float,
  };
  let mut encoded_buf = Vec::new();
  let mut writer = hound::WavWriter::new(Cursor::new(&mut encoded_buf), spec).unwrap();
  if sample_data.len() % 4 != 0 {
    error!(
      "Invalid data length of {} when trying to encode wav",
      sample_data.len()
    );
    return Err(String::from(
      "Invalid data length; should be multiple of 4 bytes for f32 array",
    ));
  }
  for sample_bytes in sample_data.chunks_exact(4) {
    let sample: f32 = unsafe {
      std::mem::transmute([
        sample_bytes[0],
        sample_bytes[1],
        sample_bytes[2],
        sample_bytes[3],
      ])
    };
    writer.write_sample(sample).map_err(|err| {
      error!("Error writing sample to wav writer: {:?}", err);
      String::from("Internal error encoding sample")
    })?;
  }
  writer.finalize().map_err(|err| {
    error!("Error finalizing wav writer: {:?}", err);
    String::from("Internal error encoding sample")
  })?;

  Ok(encoded_buf)
}

#[post("/remote_samples?<name>", data = "<sample_data>")]
pub async fn store_remote_sample(
  mut name: String,
  sample_data: rocket::Data<'_>,
  conn: WebSynthDbConn,
) -> Result<Json<RemoteSample>, String> {
  use crate::schema::remote_sample_urls;

  let mut sample_data_buf = Vec::new();
  if let Err(err) = sample_data
    .open(20usize.mebibytes())
    .stream_to(&mut sample_data_buf)
    .await
  {
    error!("Error reading sample data from request: {:?}", err);
    return Err(String::from("Error reading request body"));
  }

  let mut hasher = Sha256::new();
  hasher.update(&sample_data_buf);
  let sample_hash = hasher.finalize();
  let sample_id = format!(
    "{}{}",
    hex::encode(&sample_hash),
    Path::new(&name)
      .extension()
      .map(|s| format!(".{}", s.to_string_lossy()))
      .unwrap_or_default()
  );

  // Encode the sample to .wav
  let encoded_sample_data = encode_to_wav(sample_data_buf)?;

  // Update the extension of the name if necessary
  let mut name_path: PathBuf = Path::new(&name).to_owned();
  name_path.set_extension("wav");
  name = name_path.to_string_lossy().into();

  // Check if we already have this sample stored.  If so, we don't need to do anything since the
  // hash guarentees it's the exact same one.
  let sample_id_c = sample_id.clone();
  let sample_url = format!("{}{}", REMOTE_SAMPLES_BUCKET_URL, sample_id);
  let remote_sample = RemoteSample {
    name: name.clone(),
    id: sample_id,
    sample_url,
  };

  let existing_samples_for_id: Vec<RemoteSample> = conn
    .run(|conn| {
      remote_sample_urls::table
        .find((sample_id_c, name))
        .load(conn)
    })
    .await
    .map_err(|err| {
      error!(
        "Error querying DB to check if sample already exists: {:?}",
        err
      );
      String::from("DB Error")
    })?;

  // If we have an exact match, we actually have nothing to do
  if existing_samples_for_id.iter().any(|o| *o == remote_sample) {
    return Ok(Json(remote_sample));
  }

  if existing_samples_for_id.is_empty() {
    // Forward the request to the Faust server / generic go server that we forced into doing
    // other things as well
    let res = reqwest::Client::new()
      .post(&format!(
        "{}/remote_samples/{}?token={}",
        FAUST_SERVER_URL,
        remote_sample.id,
        crate::conf::CONF.auth_token
      ))
      .body(encoded_sample_data)
      .send()
      .await;
    let res = match res {
      Ok(res) => res,
      Err(err) => {
        error!("Error querying go server RPC to store sample: {:?}", err);
        return Err(String::from("Error saving sample"));
      },
    };
    if res.status() != 200 {
      error!(
        "Error querying go server RPC to store sample: {:?}",
        res.text().await
      );
      return Err(String::from("Error saving sample"));
    }
  }

  let remote_sample_c = remote_sample.clone();
  conn
    .run(move |conn| {
      diesel::insert_into(remote_sample_urls::table)
        .values(remote_sample_c)
        .execute(conn)
    })
    .await
    .map_err(|err| {
      error!("Error saving remote sample entry to DB: {:?}", err);
      String::from("DB error")
    })?;

  Ok(Json(remote_sample))
}
