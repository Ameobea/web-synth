FROM debian:jessie AS builder

RUN apt-get update && apt-get install -y curl libmysqlclient-dev build-essential

# Install rust
RUN curl https://sh.rustup.rs/ -sSf | \
  sh -s -- -y --default-toolchain nightly-2019-11-25

ENV PATH="/root/.cargo/bin:${PATH}"

ADD . ./

RUN cargo build --release

FROM debian:jessie

RUN apt-get update && apt-get install -y libmysqlclient-dev

COPY --from=builder \
  /target/release/web-synth-backend \
  /usr/local/bin/
COPY --from=builder \
  /Rocket.toml \
  /root/Rocket.toml
WORKDIR /root
CMD ROCKET_PORT=$PORT /usr/local/bin/web-synth-backend
