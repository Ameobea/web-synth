FROM golang:1.12.3-stretch

RUN apt update && apt install -y cmake build-essential git pkg-config python3

RUN mkdir /build
WORKDIR /build
ADD . /build
RUN go build -o faust-compiler-server .
RUN cp faust-compiler-server /usr/local/bin/

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

CMD ["/usr/local/bin/faust-compiler-server"]
