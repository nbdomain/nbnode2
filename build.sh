#docker buildx build . --platform linux/amd64,linux/arm64,linux/arm/v7 -t bloodchen/nbdb --push
docker container stop nbdb
docker container rm nbdb
docker build -t nbdb .
mkdir data && chmod a+rw data
docker run --name nbdb -p 9100:9000 -v $(pwd)/data:/home/node/app/data --restart=always -d nbdb
