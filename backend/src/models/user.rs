use std::convert::Infallible;

use rocket::{
  request::{FromRequest, Outcome},
  Request,
};

use crate::schema::{login_tokens, users};

#[derive(Insertable)]
#[diesel(table_name = users)]
pub struct NewUser {
  pub username: String,
  pub hashed_password: String,
}

#[derive(Insertable)]
#[diesel(table_name = login_tokens)]
pub struct NewLoginToken {
  pub user_id: i64,
  pub token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
  pub username: String,
  pub password: String,
}

#[derive(Queryable)]
pub struct User {
  pub id: i64,
  pub username: String,
  pub hashed_password: String,
  pub last_login: chrono::NaiveDateTime,
}

pub struct MaybeLoginToken(pub Option<String>);

#[rocket::async_trait]
impl<'r> FromRequest<'r> for MaybeLoginToken {
  type Error = Infallible;

  async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
    let token = request
      .headers()
      .get_one("Authorization")
      .filter(|token| !token.is_empty())
      .map(|token| token.to_string());
    Outcome::Success(MaybeLoginToken(token))
  }
}
