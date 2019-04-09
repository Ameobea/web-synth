FROM golang:1.12.3-stretch
RUN apt update && apt install -y cmake build-essential git pkg-config

RUN mkdir /build
WORKDIR /build
ADD . /build
RUN go build -o faust-compiler-server .
RUN cp faust-compiler-server /usr/local/bin/

RUN mkdir /faust
WORKDIR /
RUN git clone https://github.com/grame-cncm/faust.git
WORKDIR /faust
RUN make
RUN make install

CMD ["/usr/local/bin/faust-compiler-server"]
