use awsregion::Region;
use chrono::NaiveDateTime;
use s3::{creds::Credentials, Bucket};

use super::remote_samples::RemoteSample;

#[derive(Queryable)]
pub struct PrivateSampleLibrary {
  pub id: u64,
  pub user_id: i64,
  pub bucket_name: String,
  /// {"R2":{"account_id":"the_account_id"}}
  pub region_json: String,
  pub public_url_base: String,
  pub access_key_id: String,
  pub secret_access_key: String,
  pub created_at: NaiveDateTime,
}

impl PrivateSampleLibrary {
  pub async fn list_remote_samples(&self) -> Result<Vec<RemoteSample>, String> {
    let region: Region = serde_json::from_str(&self.region_json).map_err(|_err| {
      error!("Error parsing region JSON: {}", self.region_json);
      String::from("Error parsing region JSON")
    })?;
    let creds = Credentials::new(
      Some(&self.access_key_id),
      Some(&self.secret_access_key),
      None,
      None,
      None,
    )
    .map_err(|err| format!("Error creating credentials: {:?}", err))?;
    let bucket = Bucket::new(&self.bucket_name, region, creds).map_err(|err| {
      error!("Error creating bucket: {:?}", err);
      String::from("Error creating bucket")
    })?;

    let pages = bucket.list(String::from(""), None).await.map_err(|err| {
      error!("Error listing objects in bucket: {:?}", err);
      String::from("Error listing objects in bucket")
    })?;

    Ok(
      pages
        .into_iter()
        .flat_map(|obj| obj.contents)
        .map(|obj| {
          let sample_url = format!("{}/{}", self.public_url_base, urlencoding::encode(&obj.key));
          RemoteSample {
            id: format!("remote_sample_lib_{}:{}", self.id, obj.key),
            name: obj.key,
            sample_url,
          }
        })
        .collect(),
    )
  }
}
