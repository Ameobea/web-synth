#!/bin/sh
DIR_NAME=`basename $PWD`
CMD="sh -c \"cd /app/${DIR_NAME} && yarn && ./build_all.sh\""
sh -c "docker run -it -v ${PWD}/..:/app ameo/sketch:latest ${CMD}"
