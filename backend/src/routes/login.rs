use rocket::{http::Status, response::status::Custom, serde::json::Json};

use crate::{
  db_util::login::{
    generate_login_token, get_user_by_username, insert_new_login_token, insert_new_user,
    verify_password,
  },
  models::user::{LoginRequest, MaybeLoginToken},
  WebSynthDbConn,
};

#[post("/login", data = "<login_request>")]
pub async fn login(
  conn: WebSynthDbConn,
  login_request: Json<LoginRequest>,
) -> Result<String, Custom<String>> {
  let login_request = login_request.into_inner();
  let user = match get_user_by_username(&conn, login_request.username)
    .await
    .map_err(|err| Custom(Status::InternalServerError, err))?
  {
    Some(user) => user,
    None =>
      return Err(Custom(
        Status::Unauthorized,
        String::from("Invalid username or password"),
      )),
  };

  if !verify_password(&login_request.password, &user.hashed_password) {
    return Err(Custom(
      Status::Unauthorized,
      String::from("Invalid username or password"),
    ));
  }

  let login_token = generate_login_token();
  insert_new_login_token(&conn, user.id, login_token.clone())
    .await
    .map_err(|err| {
      error!("DB error inserting login token: {}", err);
      Custom(Status::InternalServerError, String::from("DB error"))
    })?;

  Ok(login_token)
}

#[post("/register", data = "<login_request>")]
pub async fn register(
  conn: WebSynthDbConn,
  login_request: Json<LoginRequest>,
) -> Result<String, Custom<String>> {
  let login_request = login_request.into_inner();
  if get_user_by_username(&conn, login_request.username.clone())
    .await
    .map_err(|err| Custom(Status::InternalServerError, err))?
    .is_some()
  {
    return Err(Custom(
      Status::BadRequest,
      String::from("Username already exists"),
    ));
  }

  let user_id = insert_new_user(&conn, login_request.username, login_request.password)
    .await
    .map_err(|err| {
      error!("DB error inserting new user: {}", err);
      Custom(Status::InternalServerError, String::from("DB error"))
    })?;

  let login_token = generate_login_token();
  insert_new_login_token(&conn, user_id, login_token.clone())
    .await
    .map_err(|err| {
      error!("DB error inserting login token: {}", err);
      Custom(Status::InternalServerError, String::from("DB error"))
    })?;

  Ok(login_token)
}

#[get("/logged_in_username")]
pub async fn get_logged_in_username(
  conn: WebSynthDbConn,
  login_token: MaybeLoginToken,
) -> Result<String, Custom<String>> {
  let user = match crate::db_util::login::get_user_by_login_token(&conn, login_token).await {
    Some(user) => user,
    None =>
      return Err(Custom(
        Status::Unauthorized,
        String::from("Invalid login token"),
      )),
  };

  Ok(user.username)
}
