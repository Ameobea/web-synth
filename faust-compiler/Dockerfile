FROM golang:1.12.3-stretch as builder

RUN apt update && apt install -y cmake build-essential git pkg-config python3



RUN mkdir /faust
WORKDIR /
RUN git clone https://github.com/grame-cncm/faust.git
WORKDIR /faust
RUN git checkout 3743d55728b48194002f8360d1e632cb7a344f16
RUN make
RUN make install

# Install `wasm-opt` via `binaryen`
RUN git clone https://github.com/WebAssembly/binaryen.git /tmp/binaryen
WORKDIR /tmp/binaryen
RUN cmake . && make install
WORKDIR /
RUN rm -rf /tmp/binaryen

RUN mkdir /build
WORKDIR /build
ADD . /build
RUN go build -o faust-compiler-server .
RUN cp faust-compiler-server /usr/local/bin/

FROM buildpack-deps:stretch-scm
COPY --from=builder /usr/local/bin/faust /usr/local/bin/faust
COPY --from=builder /usr/local/bin/faust2wasm /usr/local/bin/faust2wasm
COPY --from=builder /usr/local/lib/libOSCFaust.a /usr/local/lib/libOSCFaust.a
COPY --from=builder /usr/local/share/faust/ /usr/local/share/faust/
COPY --from=builder /build/faust-compiler-server /usr/local/bin/faust-compiler-server
COPY --from=builder /usr/local/bin/wasm-opt /usr/local/bin/wasm-opt

COPY ./FaustWorkletModuleTemplate.template.js /opt/faustWorkletTemplate.template.js

RUN apt-get update && apt-get install -y ca-certificates && update-ca-certificates

CMD ["/usr/local/bin/faust-compiler-server"]
