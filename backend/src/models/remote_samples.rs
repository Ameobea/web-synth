use crate::schema::*;

#[derive(Clone, Insertable, Queryable, Serialize)]
#[table_name = "remote_sample_urls"]
pub struct RemoteSample {
    pub id: String,
    pub name: String,
    pub sample_url: String,
}
