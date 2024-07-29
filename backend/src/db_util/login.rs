use std::convert::TryFrom;

use base64::Engine;
use diesel::{prelude::*, QueryResult};
use scrypt::{
  password_hash::{
    rand_core::{OsRng, RngCore},
    PasswordHash, PasswordHasher, PasswordVerifier, Salt, SaltString,
  },
  Scrypt,
};

use crate::{
  models::user::{MaybeLoginToken, NewLoginToken, NewUser, User},
  WebSynthDbConn,
};

fn hash_password(password: &str) -> Result<String, scrypt::password_hash::Error> {
  let salt = SaltString::generate(&mut OsRng);
  let params = scrypt::Params::new(15, 2, 2, scrypt::Params::RECOMMENDED_LEN).unwrap();
  let hash = Scrypt
    .hash_password_customized(
      password.as_bytes(),
      None,
      None,
      params,
      Salt::try_from(salt.as_ref())?,
    )?
    .to_string();
  Ok(hash)
}

pub fn verify_password(password: &str, hash: &str) -> bool {
  let hash = PasswordHash::new(hash).unwrap();
  Scrypt.verify_password(password.as_bytes(), &hash).is_ok()
}

pub fn generate_login_token() -> String {
  let mut rng = OsRng;
  let mut bytes = [0u8; 64];
  rng.fill_bytes(&mut bytes);
  base64::engine::general_purpose::STANDARD.encode(&bytes)
}

pub async fn get_user_by_username(
  conn: &WebSynthDbConn,
  username: String,
) -> Result<Option<User>, String> {
  use crate::schema::users;

  let user: Option<crate::models::user::User> = conn
    .run(move |conn| -> QueryResult<Option<_>> {
      users::table
        .filter(users::dsl::username.eq(username))
        .first(conn)
        .optional()
    })
    .await
    .map_err(|err| {
      error!("DB error loading user from DB: {}", err);
      String::from("DB error loading user from DB")
    })?;

  Ok(user)
}

/// If the login token is valid, returns the ID of the logged-in user.
pub async fn validate_login_token(
  conn: &WebSynthDbConn,
  login_token: String,
) -> QueryResult<Option<i64>> {
  use crate::schema::login_tokens;

  conn
    .run(move |conn| -> QueryResult<Option<_>> {
      login_tokens::table
        .filter(login_tokens::dsl::token.eq(login_token))
        .select(login_tokens::dsl::user_id)
        .first(conn)
        .optional()
    })
    .await
}

pub async fn insert_new_user(
  conn: &WebSynthDbConn,
  username: String,
  password: String,
) -> QueryResult<i64> {
  use crate::schema::users;

  let hashed_password = hash_password(&password).map_err(|err| {
    error!("Error hashing password: {}", err);
    diesel::result::Error::RollbackTransaction
  })?;

  let username_clone = username.clone();
  conn
    .run(move |conn| {
      diesel::insert_into(users::table)
        .values(NewUser {
          username,
          hashed_password,
        })
        .execute(conn)
    })
    .await?;

  let user_id = conn
    .run(move |conn| -> QueryResult<i64> {
      users::table
        .filter(users::dsl::username.eq(username_clone))
        .select(users::dsl::id)
        .first(conn)
    })
    .await?;
  Ok(user_id)
}

pub async fn insert_new_login_token(
  conn: &WebSynthDbConn,
  user_id: i64,
  token: String,
) -> QueryResult<()> {
  use crate::schema::login_tokens;

  conn
    .run(move |conn| {
      diesel::insert_into(login_tokens::table)
        .values(NewLoginToken { user_id, token })
        .execute(conn)
    })
    .await
    .map(drop)
}

#[test]
fn test_hash_password() {
  let password = "password";
  let hash = hash_password(password).unwrap();
  assert!(verify_password(password, &hash));
}

pub async fn get_logged_in_user_id(
  conn: &WebSynthDbConn,
  login_token: MaybeLoginToken,
) -> Option<i64> {
  match login_token.0 {
    Some(login_token) => match validate_login_token(&conn, login_token).await {
      Ok(Some(user_id)) => Some(user_id),
      Ok(None) => {
        warn!("Failed to validate login token");
        None
      },
      Err(err) => {
        error!("Error while validating login token: {:?}", err);
        None
      },
    },
    None => None,
  }
}

pub async fn get_user_by_login_token(
  conn: &WebSynthDbConn,
  login_token: MaybeLoginToken,
) -> Option<User> {
  use crate::schema::users;

  let user_id = match get_logged_in_user_id(&conn, login_token).await {
    Some(user_id) => user_id,
    None => return None,
  };

  match conn
    .run(move |conn| {
      users::table
        .filter(users::dsl::id.eq(user_id))
        .first::<User>(conn)
        .optional()
    })
    .await
  {
    Ok(Some(user)) => Some(user),
    Ok(None) => {
      warn!("Failed to get user by ID");
      None
    },
    Err(err) => {
      error!("Error while getting user by ID: {:?}", err);
      None
    },
  }
}
