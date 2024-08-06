##docker buildx build . --platform linux/amd64,linux/arm64,linux/arm/v7 -t bloodchen/nbdb --push
source ./cfg/env
NAME="nbdb_${chainid}"
PORT="${dockerPort:=9100}"
docker container stop $NAME
docker container rm $NAME
docker build -t $NAME .
mkdir data && chmod a+rw data
docker run --name $NAME --ulimit nofile=90000:90000 -p $PORT:9000 \
--log-driver json-file --log-opt max-size=200m --log-opt max-file=3 \
-v $(pwd)/data:/home/node/app/data --restart=always -d $NAME
