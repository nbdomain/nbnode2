##docker buildx build . --platform linux/amd64,linux/arm64,linux/arm/v7 -t bloodchen/nbdb --push
source ./cfg/env
NAME="nbdb_${chainid}"
docker container stop $NAME
docker container rm $NAME
docker build -t $NAME .
mkdir data && chmod a+rw data
docker run --name $NAME -p 9100:9000 -v $(pwd)/data:/home/node/app/data --restart=always -d $NAME
