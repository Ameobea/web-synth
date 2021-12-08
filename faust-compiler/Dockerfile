FROM golang:1.14beta1-buster as builder

RUN apt update && apt install -y cmake build-essential git pkg-config python3

RUN mkdir /faust
WORKDIR /
RUN git clone https://github.com/grame-cncm/faust.git
WORKDIR /faust
RUN git checkout 3743d55728b48194002f8360d1e632cb7a344f16
RUN make -j
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

FROM buildpack-deps:buster-scm
COPY --from=builder /usr/local/bin/faust /usr/local/bin/faust
COPY --from=builder /usr/local/bin/faust2wasm /usr/local/bin/faust2wasm
COPY --from=builder /usr/local/lib/libOSCFaust.a /usr/local/lib/libOSCFaust.a
COPY --from=builder /usr/local/share/faust/ /usr/local/share/faust/
COPY --from=builder /build/faust-compiler-server /usr/local/bin/faust-compiler-server
COPY --from=builder /usr/local/bin/wasm-opt /usr/local/bin/wasm-opt
COPY --from=builder /usr/local/lib/libbinaryen.so /usr/local/lib/libbinaryen.so

# Install soul
RUN curl https://ameo.link/u/8qf.soul > /usr/bin/soul && chmod +x /usr/bin/soul

RUN apt-get update && apt-get install -y ca-certificates libncurses5 libasound2 libfreetype6 && update-ca-certificates && curl https://get.wasmer.io -sSfL | sh && rm -rf /root/.wasmer/bin /root/.wasmer/lib/libwasmer.a
ENV LD_LIBRARY_PATH=/root/.wasmer/lib

COPY ./FaustWorkletModuleTemplate.template.js /opt/faustWorkletTemplate.template.js
COPY ./SoulAWP.template.js /opt/SoulAWP.template.js

CMD ["/usr/local/bin/faust-compiler-server"]
