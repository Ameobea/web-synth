FROM golang:1.23-bookworm as builder

RUN apt update && apt install -y cmake build-essential git pkg-config python3

RUN mkdir /faust
WORKDIR /
RUN git clone https://github.com/grame-cncm/faust.git faust
WORKDIR /faust
RUN git checkout bfbbad9d5d4fcfcfcb9a0928e12ac19a22912f09
RUN make -j18
RUN make install

# Install `wasm-opt` via `binaryen`
RUN git clone --depth 1 https://github.com/WebAssembly/binaryen.git /tmp/binaryen
WORKDIR /tmp/binaryen
RUN git submodule init && git submodule update
RUN cmake -DBUILD_TESTS=OFF . && make install
WORKDIR /
RUN rm -rf /tmp/binaryen

RUN mkdir /build
WORKDIR /build
ADD . /build
RUN go build -o faust-compiler-server .
RUN cp faust-compiler-server /usr/local/bin/

FROM buildpack-deps:bookworm-scm
COPY --from=builder /usr/local/bin/faust /usr/local/bin/faust
COPY --from=builder /usr/local/lib/libOSCFaust.a /usr/local/lib/libOSCFaust.a
COPY --from=builder /usr/local/share/faust/ /usr/local/share/faust/
COPY --from=builder /build/faust-compiler-server /usr/local/bin/faust-compiler-server
COPY --from=builder /usr/local/bin/wasm-opt /usr/local/bin/wasm-opt
COPY --from=builder /usr/local/lib/libbinaryen.so /usr/local/lib/libbinaryen.so

# Install soul
RUN curl https://i.ameo.link/8qf.soul > /usr/bin/soul && chmod +x /usr/bin/soul

RUN apt-get update && apt-get install -y ca-certificates libncurses5 libasound2 libfreetype6 && update-ca-certificates && curl https://get.wasmer.io -sSfL | sh && rm -rf /root/.wasmer/bin /root/.wasmer/lib/libwasmer.a
ENV LD_LIBRARY_PATH=/root/.wasmer/lib

COPY ./FaustWorkletModuleTemplate.template.js /opt/faustWorkletTemplate.template.js
COPY ./SoulAWP.template.js /opt/SoulAWP.template.js

CMD ["/usr/local/bin/faust-compiler-server"]
