use std::path::Path;

use diesel::prelude::*;
use rocket::data::ToByteUnit;
use rocket_contrib::json::Json;
use sha2::{Digest, Sha256};

use crate::{models::remote_samples::RemoteSample, WebSynthDbConn};

const FAUST_SERVER_URL: &str = "https://faust-compiler-server-mi7imxlw6a-uc.a.run.app";
// const FAUST_SERVER_URL: &str = "http://localhost:4565";
const REMOTE_SAMPLES_BUCKET_URL: &str = "https://storage.googleapis.com/web-synth-remote-samples/";

#[get("/remote_samples")]
pub async fn list_remote_samples(conn: WebSynthDbConn) -> Result<Json<Vec<RemoteSample>>, String> {
    use crate::schema::remote_sample_urls;

    let all_remote_samples: Vec<RemoteSample> = conn
        .run(|conn| remote_sample_urls::table.load(conn))
        .await
        .map_err(|err| {
            error!("Error querying DB for remote samples: {:?}", err);
            String::from("DB error")
        })?;
    Ok(Json(all_remote_samples))
}

#[post("/remote_samples/<name>", data = "<sample_data>")]
pub async fn store_remote_sample(
    name: String,
    sample_data: rocket::Data,
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
    // Forward the request to the Faust server / generic go server that we forced into doing other
    // things as well
    let res = reqwest::Client::new()
        .post(&format!(
            "{}/remote_samples/{}?token={}",
            FAUST_SERVER_URL,
            sample_id,
            crate::conf::CONF.auth_token
        ))
        .body(sample_data_buf)
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

    let sample_url = format!("{}{}", REMOTE_SAMPLES_BUCKET_URL, sample_id);
    let sample_url_c = sample_url.clone();
    let remote_sample = RemoteSample {
        name,
        id: sample_id,
        sample_url: sample_url_c,
    };
    let remote_sample_c = remote_sample.clone();
    conn.run(move |conn| {
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
