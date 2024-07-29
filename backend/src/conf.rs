use dotenv;

pub struct Conf {
  pub auth_token: String,
}

lazy_static! {
  pub static ref CONF: Conf = Conf::default();
}

impl Default for Conf {
  fn default() -> Self {
    Conf {
      auth_token: dotenv::var("AUTH_TOKEN")
        .expect("The `AUTH_TOKEN` environment variable must be supplied"),
    }
  }
}
