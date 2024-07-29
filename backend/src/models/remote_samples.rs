use crate::schema::*;

#[derive(Clone, PartialEq, Insertable, Queryable, Serialize)]
#[diesel(table_name = remote_sample_urls)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSample {
  pub id: String,
  pub name: String,
  pub sample_url: String,
}
