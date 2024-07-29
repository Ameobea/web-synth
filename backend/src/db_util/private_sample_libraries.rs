use diesel::{prelude::*, QueryResult};

use crate::{models::private_sample_libraries::PrivateSampleLibrary, WebSynthDbConn};

pub async fn get_private_sample_libraries_for_user(
  conn: WebSynthDbConn,
  user_id: i64,
) -> QueryResult<Vec<PrivateSampleLibrary>> {
  use crate::schema::private_sample_libraries;

  conn
    .run(move |conn| {
      private_sample_libraries::table
        .filter(private_sample_libraries::dsl::user_id.eq(user_id))
        .load::<PrivateSampleLibrary>(conn)
    })
    .await
}
